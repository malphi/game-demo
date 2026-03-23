# Unit 1: MCP Server 架构 — 代码变更摘要

## 变更文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `backend/npc-agent/agent.py` | 重写 | 从预获取+单次LLM调用 改为 Strands Agent Tool Use 模式 |
| `backend/npc-agent/agentcore_app.py` | 修改 | AgentCore 入口适配，添加 JSON 序列化处理 |
| `backend/npc-agent/tools/validate_task.py` | 新建 | 新增 validate_task MCP Tool |
| `backend/npc-agent/tools/__init__.py` | 修改 | 新增 validate_task 导出 |
| `backend/npc-agent/prompts/npc_system_prompt.txt` | 重写 | 适配 Tool Use 模式，添加工作流指引 |
| `backend/npc-agent/requirements.txt` | 修改 | 添加 strands-agents 依赖 |

## 架构变更

### Before (预获取 + 单次 LLM 调用)
```
handle_npc_dialogue_core()
  -> prefetch_all_data() — 手动并行查询 6 张 DynamoDB 表
  -> call_bedrock_direct() — 单次 bedrock.converse() 调用
  -> parse_llm_json() — 解析 LLM 返回的 JSON
  -> create_task_from_json() — 手动校验并写入任务
```

### After (Strands Agent Tool Use)
```
handle_npc_dialogue_core()
  -> create_npc_agent() — 创建 Strands Agent（注册 8 个 tools）
  -> agent(user_message) — Agent 自主多轮调用 tools
     -> LLM 自行决定: get_player_info -> get_player_events -> get_player_tasks
     -> LLM 自行决定: get_available_monsters / get_available_items
     -> LLM 自行决定: create_task (自动校验)
     -> LLM 最终回复: NPC 对话文本
  -> _extract_created_task() — 从 Agent messages 提取已创建任务
```

## 关键决策
- 保留 FastAPI 作为本地调试入口
- 使用 `null_callback_handler` 抑制 Strands Agent 的默认控制台输出
- Tool 定义（`@tool` 装饰器）无需修改，已兼容 Strands SDK
- System Prompt 改为指引 LLM 使用工具的工作流，不再要求 JSON 输出
