# 项目架构文档（当前实现）

## 1. 项目概述

AI 驱动的 2D RPG 网页游戏 Demo。NPC 通过 Amazon Bedrock Claude Haiku 4.5 + Strands Agent SDK 动态生成任务和对话，集成 AgentCore Memory 实现有状态对话，支持事件驱动的预生成机制降低感知延迟。

---

## 2. 部署架构

### 2.1 架构总览

```
浏览器 (Phaser.js)
    ↓ WebSocket + REST (HTTP:8080)
Game Server (Express + WS, EC2 私有子网)
    ├─ AgentCore SDK → AgentCore Runtime (VPC 模式)
    │                     └─ NPC Agent (Python, Strands Agent + Memory)
    │                           ├─ Bedrock Converse API (Claude Haiku 4.5, Tool Use)
    │                           ├─ DynamoDB (玩家/任务/事件数据)
    │                           └─ Bedrock Knowledge Base (字典数据)
    ├─ DynamoDB (玩家/任务/事件持久化)
    └─ SSM Port Forwarding (本地开发访问)
```

### 2.2 运行模式

| 模式 | 说明 | AWS 依赖 |
|------|------|----------|
| 完整模式 | EC2 + AgentCore + Bedrock + DynamoDB | 全部 AWS 服务 |
| 本地调试 | SSM 端口转发到 EC2:8080 | SSM, EC2 |

### 2.3 容器化

| Dockerfile | 基础镜像 | 用途 |
|------------|----------|------|
| `backend/game-server/Dockerfile` | node:20-alpine | Game Server 容器 |
| `backend/npc-agent/Dockerfile` | python:3.12-slim | 本地开发 |
| `backend/npc-agent/Dockerfile.agentcore` | python:3.12-slim | AgentCore Runtime 生产容器 |

### 2.4 生产环境拓扑

- **Frontend**: Vite 构建 → 静态文件由 Game Server Express 提供
- **Game Server**: EC2 (ASG, 私有子网) + SSM 访问
- **NPC Agent**: AgentCore Runtime (VPC 模式, ARM64 容器)
- **数据层**: DynamoDB 6 张表、Bedrock Knowledge Base

---

## 3. 技术栈

### 3.1 前端

| 技术 | 版本 | 用途 |
|------|------|------|
| Phaser | 3.80.1 | 2D 游戏引擎 (800×600) |
| Vite | 5.4.0 | 构建工具 |
| WebSocket API | 原生 | 实时通信 |

### 3.2 Game Server

| 技术 | 用途 |
|------|------|
| Node.js 20 + Express | HTTP + 静态文件服务 |
| ws | WebSocket 服务 |
| @aws-sdk/client-dynamodb | 数据持久化 |
| @aws-sdk/client-bedrock-agentcore | 调用 NPC Agent |
| TaskPreGenerator | 事件驱动预生成缓存 |

### 3.3 NPC Agent

| 技术 | 用途 |
|------|------|
| Python 3.12 + FastAPI | HTTP 框架 (本地调试) |
| Strands Agent SDK | Agent 框架 (Tool Use 模式) |
| BedrockModel | LLM 调用 (Claude Haiku 4.5) |
| AgentCore Memory | 有状态对话 (短期+长期记忆) |
| bedrock-agentcore | AgentCore Runtime 集成 |
| boto3 | DynamoDB + KB 查询 |

**LLM 模型**: `us.anthropic.claude-haiku-4-5-20251001-v1:0`
- Prompt Caching: `cache_prompt="default"`, `cache_tools="default"`
- Temperature: 0.7, Max Tokens: 1024

### 3.4 数据层

| 服务 | 用途 |
|------|------|
| DynamoDB | 6 张表: Players, Tasks, PlayerEventSummary, Monsters, NPCs, Items |
| Bedrock Knowledge Base | 静态字典数据 (怪物/道具/NPC) 的语义搜索 |

---

## 4. NPC Agent 架构

### 4.1 核心组件

```
agent.py                           # 主入口 (FastAPI 本地 + 核心逻辑)
├── agentcore_app.py               # AgentCore Runtime 入口 (生产)
├── memory_config.py               # AgentCore Memory 会话管理
├── db_config.py                   # DynamoDB 连接配置
├── kb_client.py                   # Knowledge Base 查询客户端
├── prompts/
│   └── npc_system_prompt.txt      # System Prompt 模板 (NPC 人格+规则)
├── validation/
│   └── task_validator.py          # 任务校验器 (7 项规则)
└── tools/
    ├── create_task.py             # 创建任务 (唯一的写入工具)
    ├── get_player_info.py         # 查询玩家信息
    ├── get_player_events.py       # 查询玩家行为事件
    ├── get_player_tasks.py        # 查询玩家任务
    ├── get_monsters.py            # 查询怪物字典
    ├── get_items.py               # 查询道具字典
    └── get_npcs.py                # 查询 NPC 字典
```

### 4.2 Strands Agent 工作流 (2 次 LLM 调用)

```
User Message (玩家数据 + 字典 + 事件日志)
    ↓
LLM Call 1 (~3s): 分析玩家状态 → 决定调用 create_task
    ↓
Tool Execution: create_task → validate_task → DynamoDB 写入 (~100ms)
    ↓
LLM Call 2 (~3s): 基于工具结果生成 NPC 角色对话
    ↓
返回: {dialogue, task, debug_log}
```

**注意**: 2 次 LLM 调用是 Tool Use 模式的必要开销。LLM 第 1 次调用决定工具参数，第 2 次调用基于工具执行结果生成对话。

### 4.3 AgentCore Memory 集成

```python
# memory_config.py
AgentCoreMemoryConfig:
  memory_id = env.AGENTCORE_MEMORY_ID
  actor_id = player_id          # 同一玩家同一上下文
  session_id = f"{player_id}_{npc_id}"  # 每个玩家-NPC 对独立会话

# agent.py
with session_manager as sm:
    agent = Agent(model=bedrock_model, tools=[create_task], session_manager=sm)
    result = agent(user_message)
```

- **短期记忆**: 自动保存/恢复对话轮次
- **长期记忆**: SemanticStrategy (事实提取) + UserPreferenceStrategy (偏好提取)
- **降级模式**: `AGENTCORE_MEMORY_ID` 未设置时 → 无状态模式

### 4.4 数据预取优化

Agent 调用前，并行预取 5 张 DynamoDB 表数据注入 user message，减少工具调用：

```python
ThreadPoolExecutor(max_workers=5):
  - player_info   (Players 表)
  - player_events (PlayerEventSummary 表, 最近 10 条)
  - player_tasks  (Tasks 表, player_id-index)
  - monsters      (Monsters 表 scan)
  - items         (Items 表 scan)
```

可选 Knowledge Base 查询替代 monsters/items 的 DynamoDB scan。

### 4.5 三种调用模式

| 模式 | 触发 | 路由 |
|------|------|------|
| `greeting` | 玩家接近 NPC | 规则模板 (~100ms, 无 LLM) |
| `dialogue` | 玩家对话 NPC | Strands Agent + Memory (~6s) |
| `pre_generate` | 事件驱动 (战斗/登录/任务完成) | Strands Agent + Memory (异步) |

---

## 5. 事件驱动预生成架构

### 5.1 概述

玩家事件 (登录、战斗、任务完成、道具使用) 触发异步 LLM 调用，预生成任务和对话缓存到 Game Server。玩家对话 NPC 时即时下发。

### 5.2 流程

```
玩家事件 (battle_victory, player_login, task_completed, item_used)
    ↓ Game Server 触发
TaskPreGenerator.triggerPreGeneration(player_id, event_type, details)
    ↓ 异步 (不阻塞主流程)
AgentCore SDK → NPC Agent → handle_pre_generate()
    ├── 选择最匹配的 NPC (_select_npc_for_event)
    ├── 检查该 NPC 是否已有 active task (有则跳过)
    ├── 预取数据 + 构建 prompt
    └── Strands Agent 调用 (Memory + create_task)
    ↓
缓存结果到 TaskPreGenerator (5 分钟过期, 一次性消费)
    ↓
玩家对话 NPC 时 → consumePreGenerated() → 即时下发
```

### 5.3 NPC-事件映射

| 事件类型 | 选择的 NPC | 原因 |
|----------|-----------|------|
| player_login | npc_elder | 长老负责新手引导 |
| battle_victory | npc_elder | 长老给战斗后续任务 |
| battle_defeat | npc_healer | 药师关心战败玩家 |
| task_completed | npc_elder | 长老给下一个任务 |
| item_used | npc_healer | 药师关注药水使用 |
| level_up | npc_elder | 长老庆祝升级 |

### 5.4 NPC 寒暄模板 (规则生成, 无 LLM)

每个 NPC 有 8 种事件类型的独立寒暄模板，支持 `{target}` 变量替换 (通过 DynamoDB 查询解析 ID → 中文名)。寒暄在玩家接近 NPC 时立即返回 (~100ms)，LLM 生成的对话在寒暄播放完后过渡显示。

---

## 6. 前后端通讯

### 6.1 WebSocket (ws://host:8080/ws)

#### 客户端 → 服务端

| 消息类型 | 参数 | 用途 |
|----------|------|------|
| `battle_start` | `{player_id, monster_id}` | 发起战斗 |
| `npc_dialogue_start` | `{player_id, npc_id}` | 发起 NPC 对话 |
| `task_accept` | `{player_id, task_id}` | 接受任务 |
| `task_complete` | `{player_id, task_id}` | 完成任务 |
| `use_item` | `{player_id, item_id}` | 使用道具 |

#### 服务端 → 客户端

| 消息类型 | 用途 |
|----------|------|
| `npc_dialogue_greeting` | 规则模板寒暄 (~100ms) |
| `npc_dialogue_response` | LLM 对话 + 任务 + debug_log |
| `battle_end` | 战斗结果 |
| `task_update` | 任务状态更新 |
| `error` | 错误信息 |

### 6.2 REST API

| 方法 | 路径 | 用途 |
|------|------|------|
| POST | `/api/game/start` | 注册玩家 |
| POST | `/api/game/reset` | 重置游戏数据 |
| GET | `/api/health` | 健康检查 |

### 6.3 NPC 对话时序

```
1. 玩家接近 NPC → npc_dialogue_start
2. Game Server 并行:
   a. 发送 greeting 请求 → AgentCore → 规则模板 (~100ms)
   b. 检查预生成缓存 / 等待 in-flight / 发送 dialogue 请求
3. greeting 先返回 → npc_dialogue_greeting → 前端开始打字机效果
4. dialogue 返回 → npc_dialogue_response → 前端过渡到任务对话
```

---

## 7. 前端 UI 系统

### 7.1 对话框 (DialogueBox.js)

- 打字机效果: 100ms/字符 (寒暄和对话一致)
- 状态机: waiting → showGreeting → isWaitingAfterGreeting → transitionToDialogue
- 任务显示: 中文名 (通过 MONSTER_DICT/ITEM_DICT/NPC_DICT 解析 ID)
- 按钮: [接受任务] + [关闭], Enter 接受/关闭, Escape 关闭

### 7.2 Agent Console

右侧面板实时显示 NPC Agent 调试日志:
- `[Memory]` — Memory 状态 (ON/OFF)
- `[LLM]` — 模型配置 (model_id, region, cache)
- `[KB]` — Knowledge Base 查询结果
- `[MCP Tool]` — 工具调用 (create_task 参数和结果)
- `⏱` — 时序信息 (总耗时, agent 耗时)
- `⚡ [Pre-Generated]` — 预生成命中
- `📚/🧠/🗄️ [DynamoDB/KB/Memory]` — 数据预取来源

---

## 8. 部署流程

### 8.1 deploy.sh 选项

```bash
./infra/deploy.sh --env dev --region us-west-2              # 全量部署
./infra/deploy.sh --env dev --region us-west-2 --stack-only       # 仅 CloudFormation
./infra/deploy.sh --env dev --region us-west-2 --gameserver-only  # 仅 Game Server + Frontend
./infra/deploy.sh --env dev --region us-west-2 --agentcore-only   # 仅 NPC Agent (AgentCore)
./infra/deploy.sh --env dev --region us-west-2 --seed-only        # 仅种子数据
```

### 8.2 AgentCore 部署流程

1. Docker build (ARM64) → ECR push (带时间戳 tag)
2. 创建/更新 AgentCore Runtime (VPC 模式, 私有子网)
3. 删除旧 endpoint → 创建新 endpoint (强制容器重新部署)
4. 等待 endpoint READY

### 8.3 Game Server 部署流程

1. Vite build frontend → 打包 game-server + frontend + node_modules
2. Upload zip to S3
3. SSM 命令: 下载 zip → 解压 → 同步 AgentCore endpoint name → 重启服务

### 8.4 Endpoint 名称同步

deploy.sh `--gameserver-only` 自动从 AgentCore 获取最新 endpoint name，通过 `sed` 写入 EC2 的 `.env` 文件:
```bash
sed -i 's/AGENTCORE_ENDPOINT_NAME=.*/AGENTCORE_ENDPOINT_NAME=${current_ep_name}/' /opt/game-server/.env
```

---

## 9. AI 任务系统

### 9.1 NPC 任务类型限制

| NPC | npc_id | 任务类型 |
|-----|--------|----------|
| 村长老莫 | npc_elder | kill_monster |
| 铁匠格雷 | npc_blacksmith | collect_item |
| 商人莉娜 | npc_merchant | use_item |
| 药师艾琳 | npc_healer | use_item |
| 斥候阿克 | npc_scout | kill_monster |

### 9.2 任务校验规则 (task_validator.py)

1. 结构完整性: title, description, conditions, awards 非空
2. npc_id 存在于 NPCs 表
3. conditions.type 合法 (kill_monster/collect_item/talk_to_npc/use_item)
4. conditions.target_id 存在于对应字典表
5. awards.item_id 存在于 Items 表
6. 数值范围: 金币 1-1000, 经验 1-500, 数量 1-99
7. 任务去重: 不与 active/completed 任务的 conditions 组合重复
8. 怪物等级匹配: kill_monster 目标怪物等级 = 玩家等级

### 9.3 System Prompt 策略

- NPC 人格注入: `{npc_name}`, `{npc_role}`, `{npc_personality}`
- 任务类型限制: 每个 NPC 只能发布指定类型
- 对话要求: 极简 (1-2 句, 30 字以内), 明确说出任务内容
- 反重复: 寒暄语已单独生成，对话不重复提及玩家最近事件
- 严格输出: 只输出角色对话，禁止元信息
