# Unit 4: 延迟优化 - Code Generation Plan

## Unit 上下文

### 需求映射
- **FR-4**: LLM 推理延迟优化（感知延迟从 ~3s 降至 <1s）

### 当前状态
- NPC Agent 使用 `null_callback_handler` 抑制输出，等待完整响应后一次性返回
- Game Server 通过 `InvokeAgentRuntimeCommand` 调用 AgentCore，接收完整 JSON 后转发
- 前端收到完整对话文本后用打字机效果逐字显示（30ms/字）
- BedrockModel 未配置 Prompt Caching
- boto3 客户端每次请求重建（无连接复用）

### 关键发现
- **AgentCore 支持流式**: `agent.stream_async()` + `yield` 可流式返回，客户端通过 `text/event-stream` 接收
- **Prompt Caching**: BedrockModel 支持 `additional_model_request_fields={'prompt_caching_config': {'type': 'default'}}`
- **Strands 内部已是流式**: BedrockModel.stream() 返回 AsyncGenerator，但 `agent()` 同步调用会阻塞到完成
- **连接预热**: 模块级创建 BedrockModel 可复用 HTTP/2 连接
- **寒暄掩盖延迟**: 从 Memory 读取玩家上次行为，NPC 先寒暄一句（~2s 打字机效果），同时并行调用 LLM

### 核心优化策略

```
玩家点击 NPC
  │
  ├──[立即] Game Server 查询 Memory 短期记忆 → 生成寒暄语
  │         "上次你打赢了史莱姆，看来实力又提升了！"
  │         → 前端打字机输出（~2s）
  │
  └──[并行] 调用 AgentCore → LLM 生成任务 + 对话（~2-3s）
             → LLM 返回时，寒暄刚好结束
             → 无缝衔接显示任务对话
```

玩家感知：NPC 先亲切寒暄 → 自然过渡到任务 → 完全感受不到等待。

### 依赖
- Unit 1 (MCP Server) — 已完成
- Unit 2 (Knowledge Base) — 已完成（KB 承载字典数据，缩减 prompt 体积）
- Unit 3 (Memory) — 已完成（提供玩家历史行为数据）

---

## 执行步骤

### Step 1: 启用 Prompt Caching
- [x] 修改 `backend/npc-agent/agent.py` 的 `create_npc_agent()` 函数
- [x] 在 BedrockModel 配置中添加 `additional_model_request_fields={'prompt_caching_config': {'type': 'default'}}`
- [x] 缓存 System Prompt（NPC 人设 + 任务规则）和 Tool 定义，跨请求复用
- [x] 预期效果：减少约 50% 输入 token 处理耗时

### Step 2: 连接预热 — 模块级 BedrockModel
- [x] 将 BedrockModel 实例创建提升到模块级别（全局单例）
- [x] 在 `agent.py` 顶部创建 `_bedrock_model` 实例，`create_npc_agent()` 直接复用
- [x] 避免每次请求重建 boto3 客户端和 HTTP 连接
- [x] 预期效果：减少约 200ms 连接开销

### Step 3: 新增寒暄语生成接口
- [x] 在 `backend/npc-agent/agent.py` 新增 `generate_greeting(player_id, npc_id)` 函数
- [x] 查询 Memory 短期记忆（`get_last_k_turns`）获取上次对话摘要
- [x] 查询 `get_player_events` 获取玩家最近一次行为事件
- [x] 根据事件类型生成模板化寒暄语（无需 LLM，纯规则生成，极快）：
  - 战斗胜利 → "上次你打赢了{怪物名}，看来实力又提升了！"
  - 战斗失败 → "听说你上次遇到了点麻烦，没关系..."
  - 使用道具 → "看你上次用了{道具名}，效果不错吧？"
  - 完成任务 → "上次的任务完成得不错！这次..."
  - 首次对话 → "欢迎来到勇者大陆，年轻的冒险者！"
- [x] 返回格式：`{"greeting": "...", "npc_name": "...", "npc_id": "..."}`
- [x] 在 FastAPI 新增 `/agent/greeting` 端点（本地调试）

### Step 4: 新增 AgentCore 寒暄入口
- [x] 修改 `backend/npc-agent/agentcore_app.py`
- [x] 根据请求中的 `action` 字段路由：
  - `action: "greeting"` → 调用 `generate_greeting()`（快速返回，~100ms）
  - `action: "dialogue"`（默认）→ 调用 `handle_npc_dialogue_core()`（完整 LLM 推理）

### Step 5: 修改 Game Server — 寒暄 + 对话并行
- [x] 修改 `backend/game-server/src/handlers/npc.js` 的 `handleNPCDialogue()`
- [x] 收到 `npc_dialogue_start` 后：
  1. **立即**调用 AgentCore `action: "greeting"` 获取寒暄语
  2. **同时**发起 AgentCore `action: "dialogue"` 获取完整对话（并行，不等待寒暄结果）
  3. 寒暄语返回后，立即通过 WebSocket 发送 `npc_dialogue_greeting` 给前端
  4. 完整对话返回后，通过 WebSocket 发送 `npc_dialogue_response` 给前端
- [x] 使用 `Promise.allSettled()` 或并行调用确保两者独立

### Step 6: 修改前端 — 寒暄 + 对话衔接
- [x] 修改 `frontend/src/scenes/GameScene.js`：
  - 添加 `npc_dialogue_greeting` 消息处理
  - 收到 greeting 时，立即用打字机效果显示寒暄语（替代等待动画）
  - 收到 `npc_dialogue_response` 时，等寒暄打字结束或直接替换为完整对话
- [x] 修改 `frontend/src/ui/DialogueBox.js`：
  - 新增 `showGreeting(npcName, greetingText, onFinish)` 方法
  - 打字机结束后触发 `onFinish` 回调
  - 新增 `transitionToDialogue(text, task)` 方法：寒暄结束后无缝切换到任务对话
  - 如果 LLM 响应在寒暄结束前就到了，缓存响应，等寒暄结束后显示
  - 如果 LLM 响应在寒暄结束后才到，保持等待动画直到响应到达

### Step 7: 生成 Unit 4 代码摘要文档
- [x] 创建 `aidlc-docs/construction/unit4-latency-optimization/code/summary.md`
- [x] 记录所有修改/新建的文件清单
- [x] 记录优化策略及预期效果
- [x] 说明寒暄 + 对话的时序协议
