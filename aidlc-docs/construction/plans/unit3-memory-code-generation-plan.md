# Unit 3: AgentCore Memory 集成 - Code Generation Plan

## Unit 上下文

### 需求映射
- **FR-1**: AgentCore Memory 实现有状态 NPC 对话

### 当前状态
- NPC Agent 使用 Strands Agent SDK，每次请求创建全新 Agent 实例，无状态
- 玩家信息和事件已通过 tools 实时查询（get_player_info, get_player_events）
- 需要集成 AgentCore Memory，使同一 player_id 的对话跨请求保持上下文

### 关键发现（来自 AWS 文档）
- Strands Agent 原生支持 `session_manager` 参数，直接对接 `AgentCoreMemorySessionManager`
- `AgentCoreMemoryConfig` 配置 memory_id, session_id, actor_id
- 短期记忆：自动保存/恢复对话轮次（conversation turns）
- 长期记忆：通过 strategies 自动提取——SemanticStrategy（事实）、UserPreferenceStrategy（偏好）
- 导入路径：
  - `from bedrock_agentcore.memory import MemoryClient`
  - `from bedrock_agentcore.memory.integrations.strands.config import AgentCoreMemoryConfig, RetrievalConfig`
  - `from bedrock_agentcore.memory.integrations.strands.session_manager import AgentCoreMemorySessionManager`

### 依赖
- Unit 1 (MCP Server 架构) — 已完成
- Unit 2 (Knowledge Base) — 已完成

---

## 执行步骤

### Step 1: 创建 Memory 资源初始化脚本
- [x] 新建 `infra/memory-setup.py`
- [x] 使用 `MemoryClient.create_memory_and_wait()` 创建 Memory 资源
- [x] 配置两个长期记忆策略：
  - SemanticStrategy: 提取游戏事实（玩家成就、任务完成、装备获取等）
  - UserPreferenceStrategy: 提取玩家偏好（偏好的任务类型、常访问 NPC、游玩风格）
- [x] Namespace 模板使用 `{actorId}`（= player_id）确保玩家隔离
- [x] 输出 memory_id 供环境变量配置

### Step 2: 创建 Memory 配置模块
- [x] 新建 `backend/npc-agent/memory_config.py`
- [x] 封装 `AgentCoreMemoryConfig` 和 `AgentCoreMemorySessionManager` 创建逻辑
- [x] 函数 `create_session_manager(player_id, npc_id)`:
  - memory_id 从环境变量 `AGENTCORE_MEMORY_ID` 读取
  - actor_id = player_id（同一玩家始终同一上下文）
  - session_id = f"{player_id}_{npc_id}"（每个玩家-NPC 对有独立会话）
- [x] 处理 memory_id 未配置的情况（返回 None，Agent 退化为无状态）

### Step 3: 修改 agent.py — 集成 Memory Session Manager
- [x] 修改 `create_npc_agent()` 接受可选 `session_manager` 参数
- [x] 将 `session_manager` 传入 `Agent(session_manager=session_manager)`
- [x] 修改 `handle_npc_dialogue_core()`:
  - 在创建 Agent 前调用 `create_session_manager(player_id, npc_id)`
  - 使用 `with` 上下文管理器确保 session 正确关闭
  - 将 session_manager 传给 `create_npc_agent()`
- [x] 记录 memory 相关的 debug_log（session_id、是否使用 memory）

### Step 4: 更新 System Prompt — 引用 Memory 上下文
- [x] 修改 `prompts/npc_system_prompt.txt`
- [x] 添加 Memory 上下文提示，告知 LLM 可能有之前的对话记忆
- [x] 指导 LLM：如果记得之前的对话，可以引用；如果是首次对话，正常流程
- [x] 保持现有工作流和规则不变

### Step 5: 适配 agentcore_app.py
- [x] 确认 `agentcore_app.py` 无需修改（它调用 `handle_npc_dialogue_core()`，memory 逻辑在内部处理）

### Step 6: 更新依赖
- [x] 确认 `requirements.txt` 中 `bedrock-agentcore>=0.1.0` 已包含 memory 模块
- [x] `bedrock-agentcore-starter-toolkit` 仅用于 memory-setup.py 脚本（infra 依赖），运行时不需要

### Step 7: 生成 Unit 3 代码摘要文档
- [x] 创建 `aidlc-docs/construction/unit3-memory/code/summary.md`
- [x] 记录所有修改/新建的文件清单
- [x] 记录关键架构决策
- [x] 说明 Memory 部署流程
