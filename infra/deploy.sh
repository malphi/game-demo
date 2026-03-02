#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Game Demo — AWS Deployment Helper Script
#
# Usage:
#   ./infra/deploy.sh --env dev --region us-west-2          # Full deployment
#   ./infra/deploy.sh --env dev --region us-west-2 --stack-only
#   ./infra/deploy.sh --env dev --region us-west-2 --images-only
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
IMAGES_ONLY=false
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
  --images-only       Build and push Docker images only
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
    --images-only) IMAGES_ONLY=true; shift ;;
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
GAME_SERVER_REPO="${ECR_BASE}/game-demo-game-server-${ENV}"

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

  # Check if game server image exists in ECR
  local game_server_image=""

  if aws ecr describe-repositories --repository-names "game-demo-game-server-${ENV}" --region "${REGION}" &>/dev/null; then
    local latest_tag
    latest_tag=$(aws ecr describe-images \
      --repository-name "game-demo-game-server-${ENV}" \
      --query 'sort_by(imageDetails,&imagePushedAt)[-1].imageTags[0]' \
      --output text --region "${REGION}" 2>/dev/null || echo "")
    if [[ -n "${latest_tag}" && "${latest_tag}" != "None" ]]; then
      game_server_image="${GAME_SERVER_REPO}:${latest_tag}"
    fi
  fi

  # Check if AgentCore endpoint ARN is available
  local agentcore_endpoint_arn=""
  agentcore_endpoint_arn=$(get_agentcore_endpoint_arn 2>/dev/null || echo "")

  aws cloudformation deploy \
    --template-file "${SCRIPT_DIR}/deploy.yaml" \
    --stack-name "${STACK_NAME}" \
    --parameter-overrides \
      Environment="${ENV}" \
      GameServerImage="${game_server_image}" \
      AgentCoreEndpointArn="${agentcore_endpoint_arn}" \
    --capabilities CAPABILITY_NAMED_IAM \
    --region "${REGION}" \
    --no-fail-on-empty-changeset

  echo "    Stack deployed successfully."
  echo ""
}

# ---------------------------------------------------------------------------
# Step 2: Build and push Docker images (game server only)
# ---------------------------------------------------------------------------
build_and_push_images() {
  echo ">>> Authenticating Docker with ECR"
  aws ecr get-login-password --region "${REGION}" | \
    docker login --username AWS --password-stdin "${ECR_BASE}"
  echo ""

  local timestamp
  timestamp=$(date +%Y%m%d%H%M%S)

  # Game Server
  echo ">>> Building game-server Docker image"
  docker build --platform linux/arm64 -t game-server:latest "${PROJECT_ROOT}/backend/game-server"
  docker tag game-server:latest "${GAME_SERVER_REPO}:latest"
  docker tag game-server:latest "${GAME_SERVER_REPO}:${timestamp}"
  echo ">>> Pushing game-server image"
  docker push "${GAME_SERVER_REPO}:latest"
  docker push "${GAME_SERVER_REPO}:${timestamp}"
  echo "    game-server image pushed: ${GAME_SERVER_REPO}:${timestamp}"
  echo ""
}

# ---------------------------------------------------------------------------
# Step 3: Deploy NPC agent to AgentCore Runtime
# ---------------------------------------------------------------------------
get_agentcore_endpoint_arn() {
  # Try to get existing endpoint ARN from an AgentCore runtime endpoint
  local runtime_id
  runtime_id=$(aws bedrock-agentcore-control list-agent-runtimes \
    --query "agentRuntimeSummaries[?agentRuntimeName=='game_demo_npc_agent_${ENV}'].agentRuntimeId | [0]" \
    --output text --region "${REGION}" 2>/dev/null || echo "None")

  if [[ "${runtime_id}" == "None" || -z "${runtime_id}" ]]; then
    echo ""
    return
  fi

  local endpoint_arn
  endpoint_arn=$(aws bedrock-agentcore-control list-agent-runtime-endpoints \
    --agent-runtime-id "${runtime_id}" \
    --query "agentRuntimeEndpointSummaries[0].agentRuntimeEndpointArn" \
    --output text --region "${REGION}" 2>/dev/null || echo "None")

  if [[ "${endpoint_arn}" == "None" || -z "${endpoint_arn}" ]]; then
    echo ""
    return
  fi

  echo "${endpoint_arn}"
}

deploy_agentcore() {
  echo ">>> Deploying NPC agent to AgentCore Runtime"

  # Get the AgentCore role ARN from stack outputs
  local agentcore_role_arn
  agentcore_role_arn=$(aws cloudformation describe-stacks \
    --stack-name "${STACK_NAME}" \
    --query "Stacks[0].Outputs[?OutputKey=='AgentCoreRoleArn'].OutputValue" \
    --output text --region "${REGION}")

  # Get the artifact bucket name from stack outputs
  local artifact_bucket
  artifact_bucket=$(aws cloudformation describe-stacks \
    --stack-name "${STACK_NAME}" \
    --query "Stacks[0].Outputs[?OutputKey=='AgentCoreArtifactBucketName'].OutputValue" \
    --output text --region "${REGION}")

  # 1. Zip the NPC agent code
  echo "    Packaging NPC agent code..."
  local zip_file="/tmp/npc-agent-${ENV}.zip"
  cd "${PROJECT_ROOT}/backend/npc-agent"
  zip -r "${zip_file}" . -x '__pycache__/*' '*.pyc' '.git/*' > /dev/null
  cd "${PROJECT_ROOT}"

  # 2. Upload to S3
  local s3_key="npc-agent/npc-agent-$(date +%Y%m%d%H%M%S).zip"
  echo "    Uploading to s3://${artifact_bucket}/${s3_key}"
  aws s3 cp "${zip_file}" "s3://${artifact_bucket}/${s3_key}" --region "${REGION}"
  rm -f "${zip_file}"

  # 3. Create or update AgentCore runtime
  local runtime_name="game_demo_npc_agent_${ENV}"
  local runtime_id

  # Check if runtime already exists
  runtime_id=$(aws bedrock-agentcore-control list-agent-runtimes \
    --query "agentRuntimeSummaries[?agentRuntimeName=='${runtime_name}'].agentRuntimeId | [0]" \
    --output text --region "${REGION}" 2>/dev/null || echo "None")

  if [[ "${runtime_id}" == "None" || -z "${runtime_id}" ]]; then
    echo "    Creating new AgentCore runtime: ${runtime_name}"
    runtime_id=$(aws bedrock-agentcore-control create-agent-runtime \
      --agent-runtime-name "${runtime_name}" \
      --agent-runtime-artifact "{\"codeConfiguration\": {\"code\": {\"s3\": {\"bucket\": \"${artifact_bucket}\", \"prefix\": \"${s3_key}\"}}, \"runtime\": \"PYTHON_3_12\", \"entryPoint\": [\"agentcore_app.py\"]}}" \
      --role-arn "${agentcore_role_arn}" \
      --network-configuration '{"networkMode": "PUBLIC"}' \
      --environment-variables "{\"BEDROCK_MODEL_ID\": \"us.anthropic.claude-3-5-haiku-20241022-v1:0\", \"BEDROCK_REGION\": \"${REGION}\", \"AWS_REGION\": \"${REGION}\", \"ENV\": \"${ENV}\"}" \
      --protocol-configuration '{"serverProtocol": "HTTP"}' \
      --query 'agentRuntimeId' \
      --output text --region "${REGION}")
    echo "    AgentCore runtime created: ${runtime_id}"
  else
    echo "    Updating existing AgentCore runtime: ${runtime_id}"
    aws bedrock-agentcore-control update-agent-runtime \
      --agent-runtime-id "${runtime_id}" \
      --agent-runtime-artifact "{\"codeConfiguration\": {\"code\": {\"s3\": {\"bucket\": \"${artifact_bucket}\", \"prefix\": \"${s3_key}\"}}, \"runtime\": \"PYTHON_3_12\", \"entryPoint\": [\"agentcore_app.py\"]}}" \
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
    --query "agentRuntimeEndpointSummaries[0].agentRuntimeEndpointArn" \
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
# Step 6: Force new ECS deployment (game server only)
# ---------------------------------------------------------------------------
force_ecs_deployment() {
  local cluster_name
  cluster_name=$(aws cloudformation describe-stacks \
    --stack-name "${STACK_NAME}" \
    --query "Stacks[0].Outputs[?OutputKey=='ECSClusterName'].OutputValue" \
    --output text --region "${REGION}")

  echo ">>> Forcing new ECS deployment on cluster: ${cluster_name}"

  if aws ecs describe-services --cluster "${cluster_name}" \
    --services "game-demo-game-server-${ENV}" --region "${REGION}" \
    --query "services[?status=='ACTIVE']" --output text 2>/dev/null | grep -q "ACTIVE"; then
    aws ecs update-service --cluster "${cluster_name}" \
      --service "game-demo-game-server-${ENV}" \
      --force-new-deployment --region "${REGION}" > /dev/null
    echo "    game-server service redeployed."
  fi

  echo ""
}

# ---------------------------------------------------------------------------
# Execution
# ---------------------------------------------------------------------------

if $STACK_ONLY; then
  deploy_stack
elif $IMAGES_ONLY; then
  build_and_push_images
elif $FRONTEND_ONLY; then
  deploy_frontend
elif $SEED_ONLY; then
  seed_tables
elif $AGENTCORE_ONLY; then
  deploy_agentcore
else
  # Full deployment
  deploy_stack
  build_and_push_images
  deploy_agentcore
  # Re-deploy stack with image URIs and AgentCore endpoint now available
  deploy_stack
  deploy_frontend
  seed_tables
  force_ecs_deployment
fi

# Print outputs
echo "=============================================="
echo "  Deployment Complete!"
echo "=============================================="

CLOUDFRONT_URL=$(aws cloudformation describe-stacks \
  --stack-name "${STACK_NAME}" \
  --query "Stacks[0].Outputs[?OutputKey=='CloudFrontURL'].OutputValue" \
  --output text --region "${REGION}" 2>/dev/null || echo "N/A")

ALB_DNS=$(aws cloudformation describe-stacks \
  --stack-name "${STACK_NAME}" \
  --query "Stacks[0].Outputs[?OutputKey=='ALBDNSName'].OutputValue" \
  --output text --region "${REGION}" 2>/dev/null || echo "N/A")

echo "  CloudFront URL: ${CLOUDFRONT_URL}"
echo "  ALB DNS:        ${ALB_DNS}"
echo "=============================================="
