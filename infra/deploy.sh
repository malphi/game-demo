#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Game Demo — AWS Deployment Helper Script
#
# Usage:
#   ./infra/deploy.sh --env dev --region us-west-2          # Full deployment
#   ./infra/deploy.sh --env dev --region us-west-2 --stack-only
#   ./infra/deploy.sh --env dev --region us-west-2 --gameserver-only
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
  --gameserver-only   Build frontend + game server, deploy to EC2
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

# Select Bedrock model ID based on region
if [[ "${REGION}" == us-* ]]; then
  BEDROCK_MODEL_ID="us.anthropic.claude-haiku-4-5-20251001-v1:0"
else
  BEDROCK_MODEL_ID="global.anthropic.claude-haiku-4-5-20251001-v1:0"
fi

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

  # Resolve the CloudFront origin-facing managed prefix list for this region.
  # Restricts the internal ALB security group to CloudFront edge servers only.
  local cf_prefix_list_id=""
  cf_prefix_list_id=$(aws ec2 describe-managed-prefix-lists \
    --filters "Name=prefix-list-name,Values=com.amazonaws.global.cloudfront.origin-facing" \
    --query "PrefixLists[0].PrefixListId" \
    --output text --region "${REGION}" 2>/dev/null || echo "")
  [[ "${cf_prefix_list_id}" == "None" ]] && cf_prefix_list_id=""

  # If the VPC origin already exists, resolve its service-managed SG to tighten the ALB
  # ingress further (Phase 2). Empty on first deploy.
  local cf_vpcorigin_sg=""
  cf_vpcorigin_sg=$(get_cloudfront_vpcorigin_sg 2>/dev/null || echo "")

  # Phase 2: once the service-managed SG exists, it is the most restrictive source
  # (this distribution only). Drop the broader prefix-list rule so the ALB SG allows
  # ONLY the CloudFront VPC origin SG — true minimal exposure.
  if [[ -n "${cf_vpcorigin_sg}" ]]; then
    cf_prefix_list_id=""
  fi

  echo "    CloudFront prefix list: ${cf_prefix_list_id:-<none, phase 2>}"
  echo "    CloudFront VPC origin SG: ${cf_vpcorigin_sg:-<none, phase 1>}"

  aws cloudformation deploy \
    --template-file "${SCRIPT_DIR}/deploy.yaml" \
    --stack-name "${STACK_NAME}" \
    --parameter-overrides \
      Environment="${ENV}" \
      AgentCoreRuntimeArn="${agentcore_runtime_arn}" \
      AgentCoreEndpointName="${agentcore_endpoint_name}" \
      CloudFrontPrefixListId="${cf_prefix_list_id}" \
      CloudFrontVpcOriginSecurityGroupId="${cf_vpcorigin_sg}" \
    --capabilities CAPABILITY_NAMED_IAM \
    --region "${REGION}" \
    --no-fail-on-empty-changeset

  echo "    Stack deployed successfully."
  echo ""
}

# Resolve the CloudFront service-managed VPC origin security group.
# AWS auto-creates "CloudFront-VPCOrigins-Service-SG" once a VPC origin exists.
get_cloudfront_vpcorigin_sg() {
  local sg_id
  sg_id=$(aws ec2 describe-security-groups \
    --filters "Name=vpc-id,Values=$(get_vpc_id)" \
              "Name=group-name,Values=CloudFront-VPCOrigins-Service-SG" \
    --query "SecurityGroups[0].GroupId" \
    --output text --region "${REGION}" 2>/dev/null || echo "")
  [[ "${sg_id}" == "None" ]] && sg_id=""
  echo "${sg_id}"
}

get_vpc_id() {
  aws cloudformation describe-stacks \
    --stack-name "${STACK_NAME}" \
    --query "Stacks[0].Outputs[?OutputKey=='VPCId'].OutputValue" \
    --output text --region "${REGION}" 2>/dev/null || echo ""
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

    # Sync AgentCore endpoint name to EC2 .env
    local current_ep_name
    current_ep_name=$(get_agentcore_endpoint_name 2>/dev/null || echo "")
    local ep_update_cmd=""
    if [[ -n "${current_ep_name}" ]]; then
      echo "    Syncing AgentCore endpoint name: ${current_ep_name}"
      ep_update_cmd="sed -i 's/AGENTCORE_ENDPOINT_NAME=.*/AGENTCORE_ENDPOINT_NAME=${current_ep_name}/' /opt/game-server/.env && "
    fi

    local cmd_id
    cmd_id=$(aws ssm send-command \
      --instance-ids "${instance_id}" \
      --document-name AWS-RunShellScript \
      --parameters "commands=[\"cd /opt/game-server && aws s3 cp s3://${artifact_bucket}/game-server/latest.zip ./code.zip --region ${REGION} && unzip -o code.zip && ${ep_update_cmd}systemctl restart game-server\"]" \
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
  docker build --no-cache --platform linux/arm64 \
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
      --environment-variables "{\"BEDROCK_MODEL_ID\": \"${BEDROCK_MODEL_ID}\", \"BEDROCK_REGION\": \"${REGION}\", \"AWS_REGION\": \"${REGION}\", \"ENV\": \"${ENV}\", \"AGENTCORE_MEMORY_ID\": \"game_demo_npc_memory-PY4RBnGoHo\", \"BEDROCK_KB_ID\": \"GIMX2WDALO\"}" \
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
      --environment-variables "{\"BEDROCK_MODEL_ID\": \"${BEDROCK_MODEL_ID}\", \"BEDROCK_REGION\": \"${REGION}\", \"AWS_REGION\": \"${REGION}\", \"ENV\": \"${ENV}\", \"AGENTCORE_MEMORY_ID\": \"game_demo_npc_memory-PY4RBnGoHo\", \"BEDROCK_KB_ID\": \"GIMX2WDALO\"}" \
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

  # 5. Delete existing endpoint and recreate (forces new container deployment)
  local endpoint_arn endpoint_name
  endpoint_arn=$(aws bedrock-agentcore-control list-agent-runtime-endpoints \
    --agent-runtime-id "${runtime_id}" \
    --query "runtimeEndpoints[0].agentRuntimeEndpointArn" \
    --output text --region "${REGION}" 2>/dev/null || echo "None")

  if [[ "${endpoint_arn}" != "None" && -n "${endpoint_arn}" ]]; then
    endpoint_name=$(aws bedrock-agentcore-control list-agent-runtime-endpoints \
      --agent-runtime-id "${runtime_id}" \
      --query "runtimeEndpoints[0].name" \
      --output text --region "${REGION}" 2>/dev/null || echo "")
    echo "    Deleting existing endpoint to force container redeploy: ${endpoint_name}"
    aws bedrock-agentcore-control delete-agent-runtime-endpoint \
      --agent-runtime-id "${runtime_id}" \
      --endpoint-name "${endpoint_name}" \
      --region "${REGION}" > /dev/null 2>&1 || true

    # Wait for endpoint deletion
    echo "    Waiting for endpoint deletion..."
    local del_status="DELETING"
    waited=0
    while [[ "${del_status}" == "DELETING" && ${waited} -lt ${max_wait} ]]; do
      sleep 15
      waited=$((waited + 15))
      del_status=$(aws bedrock-agentcore-control list-agent-runtime-endpoints \
        --agent-runtime-id "${runtime_id}" \
        --query "runtimeEndpoints[?name=='${endpoint_name}'].status | [0]" \
        --output text --region "${REGION}" 2>/dev/null || echo "DELETED")
      if [[ "${del_status}" == "None" || -z "${del_status}" ]]; then
        del_status="DELETED"
      fi
      echo "      Deletion status: ${del_status} (${waited}s)"
    done
  fi

  echo "    Creating AgentCore runtime endpoint..."
  local ep_name="game_demo_npc_agent_ep_${ENV}_${timestamp}"
  endpoint_arn=$(aws bedrock-agentcore-control create-agent-runtime-endpoint \
    --agent-runtime-id "${runtime_id}" \
    --name "${ep_name}" \
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
    ep_status=$(aws bedrock-agentcore-control list-agent-runtime-endpoints \
      --agent-runtime-id "${runtime_id}" \
      --query "runtimeEndpoints[?name=='${ep_name}'].status | [0]" \
      --output text --region "${REGION}" 2>/dev/null || echo "UNKNOWN")
    echo "      Endpoint status: ${ep_status} (${waited}s)"
  done

  echo "    AgentCore deployment complete."
  echo "    Endpoint ARN: ${endpoint_arn}"
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
# Step 6: Sync AgentCore endpoint name + runtime ARN to EC2 .env
# ---------------------------------------------------------------------------
sync_agentcore_endpoint_to_ec2() {
  echo ">>> Syncing AgentCore config to EC2 .env"

  local current_ep_name current_runtime_arn
  current_ep_name=$(get_agentcore_endpoint_name 2>/dev/null || echo "")
  current_runtime_arn=$(get_agentcore_runtime_arn 2>/dev/null || echo "")

  if [[ -z "${current_ep_name}" && -z "${current_runtime_arn}" ]]; then
    echo "    No AgentCore endpoint/runtime found, skipping."
    echo ""
    return
  fi

  local asg_name instance_id
  asg_name=$(aws cloudformation describe-stacks \
    --stack-name "${STACK_NAME}" \
    --query "Stacks[0].Outputs[?OutputKey=='GameServerASGName'].OutputValue" \
    --output text --region "${REGION}")

  instance_id=$(aws autoscaling describe-auto-scaling-groups \
    --auto-scaling-group-names "${asg_name}" \
    --query "AutoScalingGroups[0].Instances[0].InstanceId" \
    --output text --region "${REGION}")

  if [[ -z "${instance_id}" || "${instance_id}" == "None" ]]; then
    echo "    No running EC2 instance found, skipping."
    echo ""
    return
  fi

  local sed_cmds=""
  if [[ -n "${current_ep_name}" ]]; then
    echo "    Endpoint name: ${current_ep_name}"
    sed_cmds="sed -i 's|AGENTCORE_ENDPOINT_NAME=.*|AGENTCORE_ENDPOINT_NAME=${current_ep_name}|' /opt/game-server/.env"
  fi
  if [[ -n "${current_runtime_arn}" ]]; then
    echo "    Runtime ARN: ${current_runtime_arn}"
    [[ -n "${sed_cmds}" ]] && sed_cmds="${sed_cmds} && "
    sed_cmds="${sed_cmds}sed -i 's|AGENTCORE_RUNTIME_ARN=.*|AGENTCORE_RUNTIME_ARN=${current_runtime_arn}|' /opt/game-server/.env"
  fi

  aws ssm send-command \
    --instance-ids "${instance_id}" \
    --document-name AWS-RunShellScript \
    --parameters "commands=[\"${sed_cmds} && systemctl restart game-server\"]" \
    --region "${REGION}" > /dev/null

  echo "    EC2 .env updated and game-server restarted."
  echo ""
}

# ---------------------------------------------------------------------------
# Execution
# ---------------------------------------------------------------------------

if $STACK_ONLY; then
  deploy_stack
elif $GAMESERVER_ONLY; then
  deploy_game_server_code
elif $SEED_ONLY; then
  seed_tables
elif $AGENTCORE_ONLY; then
  deploy_agentcore
else
  # Full deployment
  deploy_stack
  deploy_game_server_code
  deploy_agentcore
  # Re-deploy stack: picks up AgentCore endpoint AND tightens the ALB security group
  # from the CloudFront prefix list (phase 1) to the VPC origin service-managed SG
  # (phase 2) if it has been created by now. Security is enforced in both phases.
  deploy_stack
  # Sync AgentCore endpoint name to EC2 (was empty during initial game server deploy)
  sync_agentcore_endpoint_to_ec2
  seed_tables
fi

# Print outputs
echo "=============================================="
echo "  Deployment Complete!"
echo "=============================================="

# Public access URL via CloudFront
CF_URL=$(aws cloudformation describe-stacks \
  --stack-name "${STACK_NAME}" \
  --query "Stacks[0].Outputs[?OutputKey=='CloudFrontDomainName'].OutputValue" \
  --output text --region "${REGION}" 2>/dev/null || echo "N/A")

# Get EC2 instance ID for SSM (debug) access
INSTANCE_ID=$(aws autoscaling describe-auto-scaling-groups \
  --auto-scaling-group-names "$(aws cloudformation describe-stacks \
    --stack-name "${STACK_NAME}" \
    --query "Stacks[0].Outputs[?OutputKey=='GameServerASGName'].OutputValue" \
    --output text --region "${REGION}")" \
  --query "AutoScalingGroups[0].Instances[0].InstanceId" \
  --output text --region "${REGION}" 2>/dev/null || echo "N/A")

echo ""
echo "  >>> Play the game at:"
echo "        ${CF_URL}"
echo ""
echo "  (CloudFront can take ~10-15 min to finish deploying on first create.)"
echo ""
echo "  ----------------------------------------------"
echo "  EC2 Instance: ${INSTANCE_ID}"
echo "  Debug access via SSM port forwarding (optional):"
echo "    aws ssm start-session \\"
echo "      --target ${INSTANCE_ID} \\"
echo "      --document-name AWS-StartPortForwardingSession \\"
echo "      --parameters '{\"portNumber\":[\"8080\"],\"localPortNumber\":[\"8080\"]}' \\"
echo "      --region ${REGION}"
echo "    Then open: http://localhost:8080"
echo "=============================================="
