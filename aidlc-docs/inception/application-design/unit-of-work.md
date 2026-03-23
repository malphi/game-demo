# Unit of Work 定义

## Unit 1: MCP Server 架构（FR-2）

### 职责
将 NPC Agent 从"预获取数据 + 单次 LLM 调用"架构重构为 MCP Server 架构，所有游戏功能封装为 MCP tools，LLM 通过 Tool Use 模式自主调用。

### 边界
- **变更范围**: `backend/npc-agent/` 目录
- **入口保留**: FastAPI（本地调试）+ AgentCore（生产）双入口
- **不涉及**: 前端代码、Game Server WebSocket 协议、DynamoDB 表结构

### 交付物
- 8 个 MCP tools 实现（get_player_info, get_player_events, get_player_tasks, get_monsters, get_items, get_npcs, create_task, validate_task）
- Agent 核心逻辑改为 Bedrock Tool Use 模式（多轮工具调用）
- System Prompt 更新（适配 Tool Use 模式）
- FastAPI 调试入口适配新架构
- AgentCore 入口适配新架构

### 涉及文件（预估）
| 文件 | 操作 | 说明 |
|------|------|------|
| `backend/npc-agent/agent.py` | 重构 | 核心逻辑改为 Tool Use 模式 |
| `backend/npc-agent/agentcore_app.py` | 修改 | 适配 MCP 架构 |
| `backend/npc-agent/tools/*.py` | 重构 | 封装为 MCP tool 格式 |
| `backend/npc-agent/validation/task_validator.py` | 小改 | 适配 MCP tool 调用 |
| `backend/npc-agent/prompts/npc_system_prompt.txt` | 重写 | 适配 Tool Use 模式 |

---

## Unit 2: Knowledge Base 集成（FR-3）

### 职责
将静态字典数据（怪物、道具、NPC）迁移到 Amazon Bedrock Knowledge Base，MCP tools 中的字典查询改为 KB 检索。

### 边界
- **变更范围**: `backend/npc-agent/tools/`（字典查询工具）、`infra/`（KB 配置）
- **KB 数据**: 怪物字典、道具字典、NPC 字典、奖励规则
- **不涉及**: 动态数据（Players、Tasks、PlayerEventSummary 仍走 DynamoDB）

### 交付物
- Bedrock Knowledge Base 数据源文件（JSON/Markdown 格式）
- KB 创建与配置脚本
- get_monsters、get_items、get_npcs MCP tools 改为 KB 查询
- KB 数据同步脚本（从 DynamoDB seed 数据生成 KB 源文件）

### 涉及文件（预估）
| 文件 | 操作 | 说明 |
|------|------|------|
| `backend/npc-agent/tools/get_monsters.py` | 重构 | 改为 KB 查询 |
| `backend/npc-agent/tools/get_items.py` | 重构 | 改为 KB 查询 |
| `backend/npc-agent/tools/get_npcs.py` | 重构 | 改为 KB 查询 |
| `backend/npc-agent/kb/` | 新建 | KB 数据源文件目录 |
| `infra/kb-setup.py` | 新建 | KB 创建与配置脚本 |

---

## Unit 3: AgentCore Memory 集成（FR-1）

### 职责
集成 AgentCore 内置 Memory 组件，实现玩家与 NPC 之间的有状态对话。短期记忆存储实时状态，长期记忆存储历史行为与偏好。

### 边界
- **变更范围**: `backend/npc-agent/agent.py`、`backend/npc-agent/agentcore_app.py`
- **Memory 范围**: 短期记忆（玩家状态、最近事件）+ 长期记忆（20 次历史、偏好）
- **Session 管理**: player_id 作为 session key
- **不涉及**: 前端代码、Game Server

### 交付物
- Memory 组件初始化与配置
- 短期记忆读写逻辑（每次交互刷新）
- 长期记忆读写逻辑（累积更新）
- Session 管理（player_id -> session 映射）
- System Prompt 更新（引用 Memory 上下文）

### 涉及文件（预估）
| 文件 | 操作 | 说明 |
|------|------|------|
| `backend/npc-agent/agent.py` | 修改 | 集成 Memory 读写 |
| `backend/npc-agent/agentcore_app.py` | 修改 | Memory 组件初始化 |
| `backend/npc-agent/memory/` | 新建 | Memory 配置与辅助逻辑 |
| `backend/npc-agent/prompts/npc_system_prompt.txt` | 修改 | 引用 Memory 上下文 |

---

## Unit 4: 延迟优化（FR-4）

### 职责
综合应用多种优化手段，将 NPC 对话的感知延迟从 ~3s 降至 <1s。

### 边界
- **变更范围**: NPC Agent（Bedrock API 调用）、Game Server（WebSocket streaming）、前端（流式渲染）
- **消息协议**: 直接修改现有 `npc_dialogue_response` 为流式模式
- **涉及全链路**: Agent → Game Server → Frontend

### 交付物
- Bedrock Converse API 改为 streaming 调用（`converse_stream`）
- Prompt Caching 配置（System Prompt 缓存）
- Game Server WebSocket 流式转发
- 前端 DialogueBox 流式渲染适配
- 连接预热（Bedrock client 预建立）

### 涉及文件（预估）
| 文件 | 操作 | 说明 |
|------|------|------|
| `backend/npc-agent/agent.py` | 修改 | converse_stream + prompt caching |
| `backend/game-server/src/handlers/npc.js` | 修改 | WebSocket 流式转发 |
| `frontend/src/ui/DialogueBox.js` | 修改 | 流式文本渲染 |
| `frontend/src/network/WebSocketClient.js` | 修改 | 处理流式消息 |
