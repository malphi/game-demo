#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Game Demo — AWS Deployment Helper Script
#
# Usage:
#   ./infra/deploy.sh --env dev --region us-west-2          # Full deployment
#   ./infra/deploy.sh --env dev --region us-west-2 --stack-only
#   ./infra/deploy.sh --env dev --region us-west-2 --gameserver-only
#   ./infra/deploy.sh --env dev --region us-west-2 --frontend-only
#   ./infra/deploy.sh --env dev --region us-west-2 --seed-only
#   ./infra/deploy.sh --env dev --region us-west-2 --agentcore-only
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Defaults
ENV="dev"
REGION="us-west-2"
STACK_NAME=""
STACK_ONLY=false
GAMESERVER_ONLY=false
FRONTEND_ONLY=false
SEED_ONLY=false
AGENTCORE_ONLY=false

usage() {
  cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Options:
  --env ENV           Environment (dev|staging|prod). Default: dev
  --region REGION     AWS region. Default: us-west-2
  --stack-name NAME   CloudFormation stack name. Default: game-demo-{env}
  --stack-only        Deploy only the CloudFormation stack
  --gameserver-only   Upload game server code and refresh EC2 instance
  --frontend-only     Build and upload frontend only
  --seed-only         Seed DynamoDB tables only
  --agentcore-only    Deploy NPC agent to AgentCore Runtime only
  -h, --help          Show this help message
EOF
  exit 0
}

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)        ENV="$2"; shift 2 ;;
    --region)     REGION="$2"; shift 2 ;;
    --stack-name) STACK_NAME="$2"; shift 2 ;;
    --stack-only) STACK_ONLY=true; shift ;;
    --gameserver-only) GAMESERVER_ONLY=true; shift ;;
    --frontend-only) FRONTEND_ONLY=true; shift ;;
    --seed-only)  SEED_ONLY=true; shift ;;
    --agentcore-only) AGENTCORE_ONLY=true; shift ;;
    -h|--help)    usage ;;
    *)            echo "Unknown option: $1"; usage ;;
  esac
done

# Derived values
STACK_NAME="${STACK_NAME:-game-demo-${ENV}}"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text --region "${REGION}")
ECR_BASE="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"

echo "=============================================="
echo "  Game Demo — AWS Deployment"
echo "=============================================="
echo "  Environment:  ${ENV}"
echo "  Region:       ${REGION}"
echo "  Stack:        ${STACK_NAME}"
echo "  Account:      ${ACCOUNT_ID}"
echo "=============================================="
echo ""

# ---------------------------------------------------------------------------
# Step 1: Deploy CloudFormation stack
# ---------------------------------------------------------------------------
deploy_stack() {
  echo ">>> Deploying CloudFormation stack: ${STACK_NAME}"

  # Check if AgentCore runtime/endpoint are available
  local agentcore_runtime_arn=""
  local agentcore_endpoint_name=""
  agentcore_runtime_arn=$(get_agentcore_runtime_arn 2>/dev/null || echo "")
  agentcore_endpoint_name=$(get_agentcore_endpoint_name 2>/dev/null || echo "")

  aws cloudformation deploy \
    --template-file "${SCRIPT_DIR}/deploy.yaml" \
    --stack-name "${STACK_NAME}" \
    --parameter-overrides \
      Environment="${ENV}" \
      AgentCoreRuntimeArn="${agentcore_runtime_arn}" \
      AgentCoreEndpointName="${agentcore_endpoint_name}" \
    --capabilities CAPABILITY_NAMED_IAM \
    --region "${REGION}" \
    --no-fail-on-empty-changeset

  echo "    Stack deployed successfully."
  echo ""
}

# ---------------------------------------------------------------------------
# Step 2: Package and upload game server code to S3, refresh EC2
# ---------------------------------------------------------------------------
deploy_game_server_code() {
  echo ">>> Building frontend"
  cd "${PROJECT_ROOT}/frontend"
  npm install
  npm run build
  cd "${PROJECT_ROOT}"

  echo ">>> Packaging game server code (with frontend)"

  # Get artifact bucket from stack outputs
  local artifact_bucket
  artifact_bucket=$(aws cloudformation describe-stacks \
    --stack-name "${STACK_NAME}" \
    --query "Stacks[0].Outputs[?OutputKey=='AgentCoreArtifactBucketName'].OutputValue" \
    --output text --region "${REGION}")

  # Create temp directory with game server + frontend
  local tmp_dir="/tmp/game-server-package-${ENV}"
  rm -rf "${tmp_dir}"
  mkdir -p "${tmp_dir}"

  # Copy game server code (exclude .git and public, keep node_modules)
  rsync -a --exclude='.git' --exclude='public' \
    "${PROJECT_ROOT}/backend/game-server/" "${tmp_dir}/"

  # Install production dependencies (pre-packaged in zip so EC2 needs no internet)
  cd "${tmp_dir}"
  npm ci --production
  cd "${PROJECT_ROOT}"

  # Copy frontend build output as public/
  cp -r "${PROJECT_ROOT}/frontend/dist" "${tmp_dir}/public"

  # Zip everything (including node_modules)
  local zip_path="/tmp/game-server-${ENV}.zip"
  rm -f "${zip_path}"
  cd "${tmp_dir}"
  zip -r "${zip_path}" . > /dev/null
  cd "${PROJECT_ROOT}"
  rm -rf "${tmp_dir}"

  echo ">>> Uploading to s3://${artifact_bucket}/game-server/latest.zip"
  aws s3 cp "${zip_path}" "s3://${artifact_bucket}/game-server/latest.zip" --region "${REGION}"
  echo "    Game server code + frontend uploaded."

  # Update running EC2 instance via SSM
  local asg_name instance_id
  asg_name=$(aws cloudformation describe-stacks \
    --stack-name "${STACK_NAME}" \
    --query "Stacks[0].Outputs[?OutputKey=='GameServerASGName'].OutputValue" \
    --output text --region "${REGION}")

  instance_id=$(aws autoscaling describe-auto-scaling-groups \
    --auto-scaling-group-names "${asg_name}" \
    --query "AutoScalingGroups[0].Instances[0].InstanceId" \
    --output text --region "${REGION}")

  if [[ -n "${instance_id}" && "${instance_id}" != "None" ]]; then
    echo ">>> Deploying code to EC2 instance: ${instance_id}"
    local cmd_id
    cmd_id=$(aws ssm send-command \
      --instance-ids "${instance_id}" \
      --document-name AWS-RunShellScript \
      --parameters "commands=[\"cd /opt/game-server && aws s3 cp s3://${artifact_bucket}/game-server/latest.zip ./code.zip --region ${REGION} && unzip -o code.zip && systemctl restart game-server\"]" \
      --region "${REGION}" \
      --query "Command.CommandId" --output text)

    # Wait for command to complete
    echo "    Waiting for deployment to complete..."
    aws ssm wait command-executed \
      --command-id "${cmd_id}" \
      --instance-id "${instance_id}" \
      --region "${REGION}" 2>/dev/null || sleep 30

    local cmd_status
    cmd_status=$(aws ssm get-command-invocation \
      --command-id "${cmd_id}" \
      --instance-id "${instance_id}" \
      --query "Status" --output text \
      --region "${REGION}" 2>/dev/null || echo "Unknown")
    echo "    Deploy status: ${cmd_status}"
  else
    echo "    No running EC2 instance found. Code will be loaded on next instance boot."
  fi
  echo ""
}

# ---------------------------------------------------------------------------
# Step 3: Deploy NPC agent to AgentCore Runtime
# ---------------------------------------------------------------------------
get_agentcore_runtime_arn() {
  # Get the runtime ARN from an existing AgentCore runtime
  local runtime_arn
  runtime_arn=$(aws bedrock-agentcore-control list-agent-runtimes \
    --query "agentRuntimes[?agentRuntimeName=='game_demo_npc_agent_${ENV}'].agentRuntimeArn | [0]" \
    --output text --region "${REGION}" 2>/dev/null || echo "None")

  if [[ "${runtime_arn}" == "None" || -z "${runtime_arn}" ]]; then
    echo ""
    return
  fi

  echo "${runtime_arn}"
}

get_agentcore_endpoint_name() {
  # Get the endpoint name from an existing AgentCore runtime endpoint
  local runtime_id
  runtime_id=$(aws bedrock-agentcore-control list-agent-runtimes \
    --query "agentRuntimes[?agentRuntimeName=='game_demo_npc_agent_${ENV}'].agentRuntimeId | [0]" \
    --output text --region "${REGION}" 2>/dev/null || echo "None")

  if [[ "${runtime_id}" == "None" || -z "${runtime_id}" ]]; then
    echo ""
    return
  fi

  local endpoint_name
  endpoint_name=$(aws bedrock-agentcore-control list-agent-runtime-endpoints \
    --agent-runtime-id "${runtime_id}" \
    --query "runtimeEndpoints[0].name" \
    --output text --region "${REGION}" 2>/dev/null || echo "None")

  if [[ "${endpoint_name}" == "None" || -z "${endpoint_name}" ]]; then
    echo ""
    return
  fi

  echo "${endpoint_name}"
}

deploy_agentcore() {
  echo ">>> Deploying NPC agent to AgentCore Runtime (container-based)"

  # Get the AgentCore role ARN from stack outputs
  local agentcore_role_arn
  agentcore_role_arn=$(aws cloudformation describe-stacks \
    --stack-name "${STACK_NAME}" \
    --query "Stacks[0].Outputs[?OutputKey=='AgentCoreRoleArn'].OutputValue" \
    --output text --region "${REGION}")

  # NPC agent ECR URI (repo managed outside CloudFormation)
  local npc_agent_ecr_uri="${ECR_BASE}/game-demo-npc-agent-${ENV}"

  # Ensure ECR repo exists
  if ! aws ecr describe-repositories --repository-names "game-demo-npc-agent-${ENV}" --region "${REGION}" &>/dev/null; then
    echo "    Creating ECR repository: game-demo-npc-agent-${ENV}"
    aws ecr create-repository --repository-name "game-demo-npc-agent-${ENV}" --region "${REGION}" > /dev/null
  fi

  # 1. Build and push container image for AgentCore
  echo "    Building NPC agent container image for AgentCore..."
  docker build --platform linux/arm64 \
    -f "${PROJECT_ROOT}/backend/npc-agent/Dockerfile.agentcore" \
    -t npc-agent-agentcore:latest \
    "${PROJECT_ROOT}/backend/npc-agent"

  local timestamp
  timestamp=$(date +%Y%m%d%H%M%S)
  docker tag npc-agent-agentcore:latest "${npc_agent_ecr_uri}:latest"
  docker tag npc-agent-agentcore:latest "${npc_agent_ecr_uri}:${timestamp}"

  echo "    Pushing NPC agent image to ECR..."
  aws ecr get-login-password --region "${REGION}" | \
    docker login --username AWS --password-stdin "${ECR_BASE}"
  docker push "${npc_agent_ecr_uri}:latest"
  docker push "${npc_agent_ecr_uri}:${timestamp}"
  echo "    NPC agent image pushed: ${npc_agent_ecr_uri}:${timestamp}"

  # 2. Get VPC config from stack outputs for private networking
  local subnet1 subnet2 agentcore_sg
  subnet1=$(aws cloudformation describe-stacks --stack-name "${STACK_NAME}" \
    --query "Stacks[0].Outputs[?OutputKey=='PrivateSubnet1Id'].OutputValue" \
    --output text --region "${REGION}")
  subnet2=$(aws cloudformation describe-stacks --stack-name "${STACK_NAME}" \
    --query "Stacks[0].Outputs[?OutputKey=='PrivateSubnet2Id'].OutputValue" \
    --output text --region "${REGION}")
  agentcore_sg=$(aws cloudformation describe-stacks --stack-name "${STACK_NAME}" \
    --query "Stacks[0].Outputs[?OutputKey=='AgentCoreSecurityGroupId'].OutputValue" \
    --output text --region "${REGION}")

  local vpc_network_config="{\"networkMode\": \"VPC\", \"networkModeConfig\": {\"subnets\": [\"${subnet1}\", \"${subnet2}\"], \"securityGroups\": [\"${agentcore_sg}\"]}}"
  echo "    VPC config: subnets=[${subnet1}, ${subnet2}], sg=${agentcore_sg}"

  # 3. Create or update AgentCore runtime with container artifact (VPC mode)
  local runtime_name="game_demo_npc_agent_${ENV}"
  local runtime_id
  local container_uri="${npc_agent_ecr_uri}:${timestamp}"

  # Check if runtime already exists
  runtime_id=$(aws bedrock-agentcore-control list-agent-runtimes \
    --query "agentRuntimes[?agentRuntimeName=='${runtime_name}'].agentRuntimeId | [0]" \
    --output text --region "${REGION}" 2>/dev/null || echo "None")

  if [[ "${runtime_id}" == "None" || -z "${runtime_id}" ]]; then
    echo "    Creating new AgentCore runtime: ${runtime_name} (VPC mode)"
    runtime_id=$(aws bedrock-agentcore-control create-agent-runtime \
      --agent-runtime-name "${runtime_name}" \
      --agent-runtime-artifact "{\"containerConfiguration\": {\"containerUri\": \"${container_uri}\"}}" \
      --role-arn "${agentcore_role_arn}" \
      --network-configuration "${vpc_network_config}" \
      --environment-variables "{\"BEDROCK_MODEL_ID\": \"us.anthropic.claude-3-5-haiku-20241022-v1:0\", \"BEDROCK_REGION\": \"${REGION}\", \"AWS_REGION\": \"${REGION}\", \"ENV\": \"${ENV}\"}" \
      --protocol-configuration '{"serverProtocol": "HTTP"}' \
      --query 'agentRuntimeId' \
      --output text --region "${REGION}")
    echo "    AgentCore runtime created: ${runtime_id}"
  else
    echo "    Updating existing AgentCore runtime: ${runtime_id} (VPC mode)"
    aws bedrock-agentcore-control update-agent-runtime \
      --agent-runtime-id "${runtime_id}" \
      --agent-runtime-artifact "{\"containerConfiguration\": {\"containerUri\": \"${container_uri}\"}}" \
      --role-arn "${agentcore_role_arn}" \
      --network-configuration "${vpc_network_config}" \
      --environment-variables "{\"BEDROCK_MODEL_ID\": \"us.anthropic.claude-3-5-haiku-20241022-v1:0\", \"BEDROCK_REGION\": \"${REGION}\", \"AWS_REGION\": \"${REGION}\", \"ENV\": \"${ENV}\"}" \
      --region "${REGION}" > /dev/null
    echo "    AgentCore runtime updated."
  fi

  # 4. Wait for runtime to be READY
  echo "    Waiting for AgentCore runtime to reach READY status..."
  local status="CREATING"
  local max_wait=300
  local waited=0
  while [[ "${status}" != "READY" && "${status}" != "ACTIVE" && ${waited} -lt ${max_wait} ]]; do
    sleep 10
    waited=$((waited + 10))
    status=$(aws bedrock-agentcore-control get-agent-runtime \
      --agent-runtime-id "${runtime_id}" \
      --query 'status' \
      --output text --region "${REGION}" 2>/dev/null || echo "UNKNOWN")
    echo "      Status: ${status} (${waited}s)"
    if [[ "${status}" == "FAILED" ]]; then
      echo "    ERROR: AgentCore runtime failed to deploy."
      return 1
    fi
  done

  # 5. Create or get endpoint
  local endpoint_arn
  endpoint_arn=$(aws bedrock-agentcore-control list-agent-runtime-endpoints \
    --agent-runtime-id "${runtime_id}" \
    --query "runtimeEndpoints[0].agentRuntimeEndpointArn" \
    --output text --region "${REGION}" 2>/dev/null || echo "None")

  if [[ "${endpoint_arn}" == "None" || -z "${endpoint_arn}" ]]; then
    echo "    Creating AgentCore runtime endpoint..."
    endpoint_arn=$(aws bedrock-agentcore-control create-agent-runtime-endpoint \
      --agent-runtime-id "${runtime_id}" \
      --name "game_demo_npc_agent_ep_${ENV}" \
      --query 'agentRuntimeEndpointArn' \
      --output text --region "${REGION}")
    echo "    Endpoint created: ${endpoint_arn}"

    # Wait for endpoint to be ready
    echo "    Waiting for endpoint to be ready..."
    local ep_status="CREATING"
    waited=0
    while [[ "${ep_status}" != "READY" && "${ep_status}" != "ACTIVE" && ${waited} -lt ${max_wait} ]]; do
      sleep 10
      waited=$((waited + 10))
      ep_status=$(aws bedrock-agentcore-control get-agent-runtime-endpoint \
        --agent-runtime-endpoint-arn "${endpoint_arn}" \
        --query 'status' \
        --output text --region "${REGION}" 2>/dev/null || echo "UNKNOWN")
      echo "      Endpoint status: ${ep_status} (${waited}s)"
    done
  else
    echo "    Using existing endpoint: ${endpoint_arn}"
  fi

  echo "    AgentCore deployment complete."
  echo "    Endpoint ARN: ${endpoint_arn}"
  echo ""
}

# ---------------------------------------------------------------------------
# Step 4: Build and upload frontend
# ---------------------------------------------------------------------------
deploy_frontend() {
  echo ">>> Building frontend"
  cd "${PROJECT_ROOT}/frontend"
  npm install
  npm run build
  cd "${PROJECT_ROOT}"
  echo ""

  # Get S3 bucket name from stack outputs
  local bucket_name
  bucket_name=$(aws cloudformation describe-stacks \
    --stack-name "${STACK_NAME}" \
    --query "Stacks[0].Outputs[?OutputKey=='FrontendBucketName'].OutputValue" \
    --output text --region "${REGION}")

  echo ">>> Uploading frontend to s3://${bucket_name}/"
  aws s3 sync "${PROJECT_ROOT}/frontend/dist/" "s3://${bucket_name}/" \
    --delete --region "${REGION}"
  echo "    Frontend uploaded."
  echo ""

  # Invalidate CloudFront cache
  local distribution_id
  distribution_id=$(aws cloudformation describe-stacks \
    --stack-name "${STACK_NAME}" \
    --query "Stacks[0].Outputs[?OutputKey=='CloudFrontDistributionId'].OutputValue" \
    --output text --region "${REGION}")

  echo ">>> Invalidating CloudFront cache (distribution: ${distribution_id})"
  aws cloudfront create-invalidation \
    --distribution-id "${distribution_id}" \
    --paths "/*" --region "${REGION}" > /dev/null
  echo "    Cache invalidation submitted."
  echo ""
}

# ---------------------------------------------------------------------------
# Step 5: Seed DynamoDB tables
# ---------------------------------------------------------------------------
seed_tables() {
  echo ">>> Seeding DynamoDB tables"
  cd "${SCRIPT_DIR}"
  python3 seed_data.py --region "${REGION}" --env "${ENV}"
  cd "${PROJECT_ROOT}"
  echo ""
}

# ---------------------------------------------------------------------------
# Execution
# ---------------------------------------------------------------------------

if $STACK_ONLY; then
  deploy_stack
elif $GAMESERVER_ONLY; then
  deploy_game_server_code
elif $FRONTEND_ONLY; then
  deploy_frontend
elif $SEED_ONLY; then
  seed_tables
elif $AGENTCORE_ONLY; then
  deploy_agentcore
else
  # Full deployment
  deploy_stack
  deploy_game_server_code
  deploy_agentcore
  # Re-deploy stack with AgentCore endpoint now available
  deploy_stack
  deploy_frontend
  seed_tables
fi

# Print outputs
echo "=============================================="
echo "  Deployment Complete!"
echo "=============================================="

CLOUDFRONT_URL=$(aws cloudformation describe-stacks \
  --stack-name "${STACK_NAME}" \
  --query "Stacks[0].Outputs[?OutputKey=='CloudFrontURL'].OutputValue" \
  --output text --region "${REGION}" 2>/dev/null || echo "N/A")

echo "  CloudFront URL: ${CLOUDFRONT_URL}"
echo "=============================================="
