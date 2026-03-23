# Build Instructions

## Prerequisites

### System Requirements
- **Node.js**: >= 18.x
- **Python**: >= 3.11
- **npm**: >= 9.x
- **pip**: >= 23.x
- **AWS CLI**: >= 2.x (configured with valid credentials)
- **OS**: macOS / Linux

### AWS Services Required
- Amazon DynamoDB
- Amazon Bedrock (Claude Haiku model access)
- Amazon Bedrock AgentCore Runtime
- Amazon Bedrock Knowledge Base
- Amazon S3 (for KB data source)

### Environment Variables

#### NPC Agent (`backend/npc-agent/`)
```bash
export AWS_REGION=us-west-2
export BEDROCK_MODEL_ID=us.anthropic.claude-4-5-haiku-20251001-v1:0
export BEDROCK_REGION=us-west-2
export BEDROCK_KB_ID=<your-knowledge-base-id>          # FR-3: Knowledge Base
export AGENTCORE_MEMORY_ID=<your-memory-id>            # FR-1: AgentCore Memory
export ENV=<environment-prefix>                         # DynamoDB table prefix (optional)
export DYNAMODB_ENDPOINT=http://localhost:8000          # Local DynamoDB only
```

#### Game Server (`backend/game-server/`)
```bash
export AWS_REGION=us-west-2
export AGENTCORE_RUNTIME_ARN=<your-agentcore-runtime-arn>
export AGENTCORE_ENDPOINT_NAME=<your-endpoint-name>     # Optional
export ENV=<environment-prefix>                          # DynamoDB table prefix (optional)
export DYNAMODB_ENDPOINT=http://localhost:8000           # Local DynamoDB only
export PORT=3000                                         # Default: 3000
```

## Build Steps

### 1. Install Dependencies

```bash
# Frontend
cd /Users/ruofeima/code/game-demo/frontend
npm install

# Game Server
cd /Users/ruofeima/code/game-demo/backend/game-server
npm install

# NPC Agent
cd /Users/ruofeima/code/game-demo/backend/npc-agent
pip install -r requirements.txt
```

### 2. Build Frontend

```bash
cd /Users/ruofeima/code/game-demo/frontend
npm run build
```

- **Expected Output**: `dist/` directory with bundled JS, HTML, CSS
- **Verify**: `ls dist/index.html` exists

### 3. Infrastructure Setup (First Time Only)

#### a. Create DynamoDB Tables (Local Development)

```bash
cd /Users/ruofeima/code/game-demo/infra
python create_tables_local.py
```

#### b. Seed Game Data

```bash
cd /Users/ruofeima/code/game-demo/backend/game-server
npm run seed
```

#### c. Set Up Knowledge Base

```bash
# Generate KB data files from seed data
cd /Users/ruofeima/code/game-demo/infra
python kb-sync.py

# Follow kb-setup.py instructions to create KB in Bedrock Console
python kb-setup.py --help
```

#### d. Set Up AgentCore Memory

```bash
cd /Users/ruofeima/code/game-demo/infra
python memory-setup.py --name game-demo-memory --region us-west-2
# Note the output memory_id and set AGENTCORE_MEMORY_ID
```

### 4. Start Services (Development Mode)

```bash
# Terminal 1: Game Server
cd /Users/ruofeima/code/game-demo/backend/game-server
npm run dev

# Terminal 2: NPC Agent (local FastAPI mode)
cd /Users/ruofeima/code/game-demo/backend/npc-agent
python agent.py

# Terminal 3: Frontend (Vite dev server)
cd /Users/ruofeima/code/game-demo/frontend
npm run dev
```

### 5. Verify Build Success

- **Frontend**: Open `http://localhost:5173` — game loads with map, player, NPCs, monsters
- **Game Server**: `http://localhost:3000/health` returns `{"status":"ok"}`
- **NPC Agent**: `http://localhost:8090/health` returns `{"status":"healthy","service":"npc-agent","mode":"strands-agent-tool-use"}`

## Troubleshooting

### Build Fails with Node.js Dependency Errors
- **Cause**: Node.js version mismatch or corrupted node_modules
- **Solution**: `rm -rf node_modules package-lock.json && npm install`

### Python Import Errors (strands, bedrock_agentcore)
- **Cause**: Missing or incompatible Python packages
- **Solution**: `pip install --upgrade -r requirements.txt`

### AWS Credential Errors
- **Cause**: Missing or expired AWS credentials
- **Solution**: `aws sts get-caller-identity` to verify, then `aws configure` or refresh SSO
