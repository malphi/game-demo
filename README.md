# Game Demo - AI-Driven 2D RPG

A full-stack 2D RPG game demo featuring AI-powered NPC dialogue and dynamic task generation. Built with Phaser.js (frontend), Node.js (game server), and Python/Strands Agents (NPC AI agent) backed by Amazon Bedrock.

## Architecture

```
┌──────────────┐       WebSocket/REST        ┌──────────────────┐
│   Frontend   │ ──────────────────────────── │   Game Server    │
│  (Phaser.js) │       :8080/ws, /api        │   (Node.js)      │
│   :3000 dev  │                              │   :8080          │
└──────────────┘                              └────────┬─────────┘
                                                       │ POST /agent/dialogue
                                                       ▼
                                              ┌──────────────────┐
                                              │   NPC Agent      │
                                              │ (Python/Strands) │
                                              │   :8090          │
                                              └────────┬─────────┘
                                                       │
                                                       ▼
                                              ┌──────────────────┐
                                              │  Amazon Bedrock  │
                                              │  (Claude)        │
                                              └──────────────────┘
                                                       │
                           ┌───────────────────────────┼──────────────────┐
                           ▼                           ▼                  ▼
                     ┌──────────┐            ┌──────────────┐     ┌────────────┐
                     │ DynamoDB │            │   Kinesis     │     │  S3 Logs   │
                     │ (6 tables)│           │  Data Stream  │     │            │
                     └──────────┘            └──────────────┘     └────────────┘
```

**Key components:**

- **Frontend** — Phaser 3 game engine with Vite build tooling. 800x600 canvas with arcade physics, pixel art rendering. Connects to the game server via WebSocket for real-time gameplay and falls back to offline mode if the server is unavailable.
- **Game Server** — Express.js with WebSocket (ws) support. Manages player sessions, battles, inventory, tasks, and NPC interactions. Supports both in-memory mode (no AWS required) and DynamoDB mode.
- **NPC Agent** — FastAPI service powered by [Strands Agents](https://github.com/strands-agents/sdk-python) and Amazon Bedrock (Claude). Analyzes player stats, behavior history, and game state to generate contextual NPC dialogue and dynamic tasks.
- **Data Layer** — DynamoDB (6 tables), Kinesis Data Stream for event analytics, S3 for log archival.

## Prerequisites

- **Node.js** >= 18
- **Python** >= 3.10
- **Docker** (for local DynamoDB or container builds)
- **AWS CLI** v2 (for deployment)
- **AWS account** with Bedrock model access enabled for `us.anthropic.claude-sonnet-4-20250514` in `us-west-2`

## Quick Start (Local Development)

### Option A: Fully Offline (No AWS)

Run everything locally with in-memory storage. The NPC agent is bypassed and the game server uses rule-based dialogue generation.

```bash
# 1. Install frontend dependencies
cd frontend && npm install && cd ..

# 2. Install game server dependencies
cd backend/game-server && npm install && cd ../..

# 3. Start the game server (in-memory mode)
cd backend/game-server && npm run dev &

# 4. Start the frontend dev server
cd frontend && npm run dev
```

Open http://localhost:3000 in your browser.

### Option B: With Local DynamoDB + NPC Agent

Run with DynamoDB Local and the AI NPC agent for the full experience.

```bash
# 1. Start DynamoDB Local
docker run -d -p 8000:8000 amazon/dynamodb-local

# 2. Create tables
cd infra && python create_tables_local.py --endpoint-url http://localhost:8000 --env dev

# 3. Seed dictionary data
python seed_data.py --endpoint-url http://localhost:8000 --env dev
cd ..

# 4. Install and start the game server (DynamoDB mode)
cd backend/game-server && npm install
USE_DYNAMODB=true AWS_REGION=us-west-2 \
  DYNAMODB_ENDPOINT=http://localhost:8000 \
  NPC_AGENT_URL=http://localhost:8090 \
  npm run dev &
cd ../..

# 5. Install and start the NPC Agent
cd backend/npc-agent
pip install -r requirements.txt
AWS_DEFAULT_REGION=us-west-2 python agent.py &
cd ../..

# 6. Start the frontend
cd frontend && npm install && npm run dev
```

> **Note:** The NPC Agent requires valid AWS credentials with Bedrock access to invoke Claude. Configure credentials via `aws configure` or environment variables (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`).

## Project Structure

```
game-demo/
├── frontend/                    # Phaser.js game client
│   ├── src/
│   │   ├── main.js              # Phaser game config & entry point
│   │   ├── network/
│   │   │   └── WebSocketClient.js
│   │   ├── scenes/
│   │   │   ├── BootScene.js     # Asset loading
│   │   │   ├── GameScene.js     # Main game world
│   │   │   ├── BattleScene.js   # Turn-based combat
│   │   │   └── UIScene.js       # HUD overlay
│   │   ├── entities/
│   │   │   ├── Player.js
│   │   │   ├── Monster.js
│   │   │   └── NPC.js
│   │   ├── ui/
│   │   │   ├── DialogueBox.js
│   │   │   ├── TaskPanel.js
│   │   │   └── InventoryPanel.js
│   │   └── data/
│   │       └── GameData.js
│   ├── assets/                  # Sprites, tilemaps, audio
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
│
├── backend/
│   ├── game-server/             # Node.js game server
│   │   ├── src/
│   │   │   ├── index.js         # Express + WebSocket entry
│   │   │   ├── seed.js          # Dictionary data seeder
│   │   │   ├── handlers/        # WebSocket message handlers
│   │   │   │   ├── session.js
│   │   │   │   ├── battle.js
│   │   │   │   ├── npc.js
│   │   │   │   └── task.js
│   │   │   ├── services/        # Business logic
│   │   │   │   ├── PlayerDataService.js
│   │   │   │   ├── BattleSystem.js
│   │   │   │   ├── TaskManager.js
│   │   │   │   ├── EventEmitter.js
│   │   │   │   └── InventoryManager.js
│   │   │   └── models/          # In-memory dictionary data
│   │   │       ├── Monster.js
│   │   │       ├── NPC.js
│   │   │       ├── Item.js
│   │   │       ├── Player.js
│   │   │       └── Task.js
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   └── npc-agent/               # Python AI agent
│       ├── agent.py             # FastAPI app + Strands Agent
│       ├── requirements.txt
│       ├── Dockerfile
│       ├── prompts/
│       │   └── npc_system_prompt.txt
│       ├── tools/               # Agent tool functions
│       │   ├── get_player_info.py
│       │   ├── get_player_events.py
│       │   ├── get_monsters.py
│       │   ├── get_items.py
│       │   ├── get_npcs.py
│       │   ├── get_player_tasks.py
│       │   └── create_task.py
│       └── validation/
│           └── task_validator.py
│
├── infra/                       # Infrastructure
│   ├── template.yaml            # CloudFormation — data layer only
│   ├── deploy.yaml              # CloudFormation — full AWS deployment
│   ├── deploy.sh                # Deployment helper script
│   ├── create_tables_local.py   # Local DynamoDB table creator
│   └── seed_data.py             # Dictionary data seeder
│
├── design.md
├── requirement.md
└── architecture.drawio
```

## AWS Deployment

### Prerequisites

1. AWS CLI configured with appropriate credentials
2. Docker installed (for building container images)
3. Amazon Bedrock model access enabled for Claude in `us-west-2`

### Deploy with the helper script

```bash
# Full deployment (builds images, deploys infra, uploads frontend, seeds data)
./infra/deploy.sh --env dev --region us-west-2

# Deploy only the CloudFormation stack
./infra/deploy.sh --env dev --region us-west-2 --stack-only

# Build and push Docker images only
./infra/deploy.sh --env dev --region us-west-2 --images-only

# Build and upload frontend only
./infra/deploy.sh --env dev --region us-west-2 --frontend-only
```

### Manual deployment steps

```bash
# 1. Deploy the CloudFormation stack
aws cloudformation deploy \
  --template-file infra/deploy.yaml \
  --stack-name game-demo-dev \
  --parameter-overrides Environment=dev \
  --capabilities CAPABILITY_NAMED_IAM \
  --region us-west-2

# 2. Get the ECR repository URIs from stack outputs
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REGION=us-west-2
GAME_SERVER_REPO="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/game-demo-game-server-dev"
NPC_AGENT_REPO="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/game-demo-npc-agent-dev"

# 3. Authenticate Docker to ECR
aws ecr get-login-password --region ${REGION} | \
  docker login --username AWS --password-stdin ${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com

# 4. Build and push game server image
cd backend/game-server
docker build -t game-server .
docker tag game-server:latest ${GAME_SERVER_REPO}:latest
docker push ${GAME_SERVER_REPO}:latest
cd ../..

# 5. Build and push NPC agent image
cd backend/npc-agent
docker build -t npc-agent .
docker tag npc-agent:latest ${NPC_AGENT_REPO}:latest
docker push ${NPC_AGENT_REPO}:latest
cd ../..

# 6. Build and upload frontend
cd frontend
npm install && npm run build
FRONTEND_BUCKET=$(aws cloudformation describe-stacks \
  --stack-name game-demo-dev \
  --query "Stacks[0].Outputs[?OutputKey=='FrontendBucketName'].OutputValue" \
  --output text --region ${REGION})
aws s3 sync dist/ s3://${FRONTEND_BUCKET}/ --delete
cd ..

# 7. Seed DynamoDB tables
cd infra
python seed_data.py --region ${REGION} --env dev
cd ..

# 8. Force new ECS deployment to pick up latest images
CLUSTER=$(aws cloudformation describe-stacks \
  --stack-name game-demo-dev \
  --query "Stacks[0].Outputs[?OutputKey=='ECSClusterName'].OutputValue" \
  --output text --region ${REGION})
aws ecs update-service --cluster ${CLUSTER} --service game-demo-game-server-dev \
  --force-new-deployment --region ${REGION}
aws ecs update-service --cluster ${CLUSTER} --service game-demo-npc-agent-dev \
  --force-new-deployment --region ${REGION}
```

After deployment, get the CloudFront URL from the stack outputs:

```bash
aws cloudformation describe-stacks \
  --stack-name game-demo-dev \
  --query "Stacks[0].Outputs[?OutputKey=='CloudFrontURL'].OutputValue" \
  --output text --region us-west-2
```

## How the AI NPC Agent Works

The NPC Agent uses the [Strands Agents](https://github.com/strands-agents/sdk-python) framework to create intelligent NPCs that respond dynamically to each player's situation.

### Flow

1. **Player talks to NPC** — the frontend sends a `npc_dialogue_start` WebSocket message to the game server.
2. **Game server calls NPC Agent** — if `NPC_AGENT_URL` is configured, the game server POSTs to `/agent/dialogue` with the player and NPC IDs.
3. **Agent gathers context** — the Strands Agent uses tool functions to query DynamoDB:
   - `get_player_info` — current level, HP, stats, inventory
   - `get_player_events` — recent battle results, NPC interactions
   - `get_player_tasks` — currently active tasks
   - `get_available_monsters/items/npcs` — game dictionary data
4. **Agent generates response** — Claude on Bedrock analyzes the player's situation using the NPC's personality and generates:
   - Contextual dialogue text matching the NPC's personality
   - A task tailored to the player's current progression
5. **Task validation** — the `create_task` tool validates all task fields (valid monster/item IDs, reasonable reward ranges, no duplicate conditions) before writing to the Tasks table.
6. **Fallback** — if the NPC Agent is unavailable, the game server uses a built-in rule-based task generator that covers the same scenarios (new player, post-defeat recovery, post-victory progression).

### NPC Personalities

| NPC | Role | Personality |
|-----|------|-------------|
| Village Elder Mo | Tutorial & main quest guide | Wise, concise, uses proverbs |
| Blacksmith Grey | Equipment & crafting quests | Rough, enthusiastic about weapons |
| Merchant Lina | Trading & item quests | Shrewd but kind, salesperson tone |
| Healer Aileen | Recovery guidance | Gentle, caring, soft-spoken |
| Scout Ark | Combat & exploration missions | Military style, tactical |

## Environment Variables

### Game Server

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | HTTP/WebSocket listen port |
| `USE_DYNAMODB` | `false` | Enable DynamoDB persistence (`true`/`false`) |
| `AWS_REGION` | `us-west-2` | AWS region for DynamoDB |
| `DYNAMODB_ENDPOINT` | — | Custom DynamoDB endpoint (for local dev) |
| `NPC_AGENT_URL` | — | NPC Agent base URL (e.g., `http://localhost:8090`) |

### NPC Agent

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8090` | FastAPI listen port |
| `BEDROCK_MODEL_ID` | `us.anthropic.claude-sonnet-4-20250514` | Bedrock model ID |
| `BEDROCK_REGION` | `us-west-2` | AWS region for Bedrock API |

## API Reference

### REST Endpoints (Game Server — :8080)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check |
| POST | `/api/game/start` | Start game session |
| POST | `/api/game/save` | Save game session |
| POST | `/api/player/create` | Create new player |
| GET | `/api/player/:id` | Get player data |
| GET | `/api/player/:id/inventory` | Get player inventory |
| GET | `/api/tasks/:playerId` | Get player tasks |
| POST | `/api/tasks/:taskId/complete` | Complete a task |
| GET | `/api/dict/monsters` | List all monsters |
| GET | `/api/dict/npcs` | List all NPCs |
| GET | `/api/dict/items` | List all items |

### WebSocket Messages (ws://.../ws)

| Type (Client → Server) | Payload |
|------------------------|---------|
| `battle_start` | `{ player_id, monster_id }` |
| `npc_dialogue_start` | `{ player_id, npc_id }` |
| `task_accept` | `{ player_id, task_id }` |
| `task_reject` | `{ player_id, task_id }` |
| `use_item` | `{ player_id, item_id }` |
| `player_move` | `{ player_id, x, y }` |
| `ping` | `{}` |

### NPC Agent Endpoints (:8090)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/agent/dialogue` | NPC dialogue (body: `{ player_id, npc_id }`) |
| GET | `/health` | Health check |
