# Unit 4: 延迟优化 - 代码摘要

## 优化策略

### 核心思路：寒暄掩盖 LLM 延迟

```
玩家点击 NPC
  │
  ├──[立即] AgentCore action:"greeting" → 规则模板生成寒暄语 (~100ms)
  │         → WebSocket npc_dialogue_greeting → 前端打字机显示 (~2s)
  │
  └──[并行] AgentCore action:"dialogue" → LLM 推理 + 任务生成 (~2-3s)
             → WebSocket npc_dialogue_response → 寒暄结束后无缝衔接
```

玩家感知：NPC 先亲切寒暄 → 自然过渡到任务对话 → 完全感受不到 LLM 等待。

### 辅助优化
1. **Prompt Caching**: BedrockModel 启用 `prompt_caching_config`，缓存 system prompt 和 tool 定义
2. **连接预热**: 模块级 `_bedrock_model` 单例，复用 HTTP/2 连接，避免每次请求重建 boto3 客户端

## 修改文件清单

### 后端 - NPC Agent
| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `backend/npc-agent/agent.py` | 修改 | 1) 模块级 BedrockModel 单例 + prompt caching; 2) 新增 `generate_greeting()` 规则模板函数; 3) 新增 `/agent/greeting` FastAPI 端点 |
| `backend/npc-agent/agentcore_app.py` | 修改 | 按 `action` 字段路由: "greeting" → `generate_greeting()`, "dialogue" → `handle_npc_dialogue_core()` |

### 后端 - Game Server
| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `backend/game-server/src/handlers/npc.js` | 修改 | `handleNPCDialogue()` 并行调用 greeting + dialogue; 新增 `callNPCAgentGreeting()` 函数; greeting 先到先发 `npc_dialogue_greeting`, dialogue 后到发 `npc_dialogue_response` |

### 前端
| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `frontend/src/scenes/GameScene.js` | 修改 | 新增 `npc_dialogue_greeting` WebSocket 消息处理 |
| `frontend/src/scenes/UIScene.js` | 修改 | 新增 `show-greeting` 事件监听和 `showGreeting()` 方法 |
| `frontend/src/ui/DialogueBox.js` | 修改 | 新增 `showGreeting()` (打字机寒暄)、`transitionToDialogue()` (无缝切换)、`showTaskInfo()` (提取复用); `show()` 增加 greeting 缓冲逻辑 |

## WebSocket 消息时序协议

```
Client                    Game Server                AgentCore
  |                           |                          |
  |-- npc_dialogue_start ---->|                          |
  |                           |-- action:"greeting" ---->|
  |                           |-- action:"dialogue" ---->|  (并行)
  |                           |                          |
  |                           |<-- greeting result ------|  (~100ms)
  |<-- npc_dialogue_greeting -|                          |
  |   [打字机显示寒暄语 ~2s]    |                          |
  |                           |<-- dialogue result ------|  (~2-3s)
  |<-- npc_dialogue_response -|                          |
  |   [寒暄结束后显示对话+任务]  |                          |
```

### 前端状态机

1. **等待态**: 显示 `......` 动画（原有逻辑）
2. **寒暄态**: 收到 `npc_dialogue_greeting` → 打字机显示寒暄语
   - 如果 LLM 响应在寒暄结束前到达 → 缓存到 `pendingDialogue`
   - 寒暄结束后自动调用 `transitionToDialogue()` 显示缓存的响应
3. **对话态**: 收到 `npc_dialogue_response` → 显示完整对话 + 任务
   - 如果正在寒暄 → 缓存；否则直接显示

## 寒暄模板

| 事件类型 | 模板 |
|---------|------|
| battle_victory | 上次你打赢了{target}，看来实力又提升了！ |
| battle_defeat | 听说你上次遇到了{target}有点吃力，没关系，这次我来帮你。 |
| task_completed | 上次的任务完成得不错！这次有个新的挑战给你。 |
| item_acquired | 看你上次获得了{target}，装备越来越好了。 |
| item_used | 上次用了{target}，效果不错吧？ |
| level_up | 恭喜你升级了！让我看看有什么适合你的新任务。 |
| talk_to_npc | 又来找我了？好的，我看看有什么新消息。 |
| (默认) | 欢迎来到勇者大陆，年轻的冒险者！让我看看能帮你什么。 |

## 预期效果

| 指标 | 优化前 | 优化后 |
|------|--------|--------|
| 感知延迟 | ~3s (等待动画) | <1s (立即显示寒暄) |
| Prompt 处理 | 每次全量 | 缓存后减少 ~50% |
| 连接开销 | ~200ms/请求 | ~0ms (复用) |
