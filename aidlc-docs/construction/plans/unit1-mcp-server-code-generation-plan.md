# Unit 1: MCP Server 架构 - Code Generation Plan

## Unit 上下文

### 需求映射
- **FR-2**: MCP Server 架构封装游戏功能

### 当前状态
- Tools 已使用 `@tool` from `strands` 装饰器，7 个工具函数已存在
- Agent 核心逻辑在 `agent.py`，使用预获取数据 + 单次 `bedrock.converse()` 调用
- 需要改为 Strands Agent SDK 的 Tool Use 模式（多轮工具调用）

### 关键发现
- `tools/*.py` 已使用 `from strands import tool` 和 `@tool` 装饰器 — 工具定义**无需大改**
- 核心变更在 `agent.py`：从手动预获取+单次调用 改为 Strands Agent 自动管理的多轮 Tool Use
- 需新增 `validate_task` 工具（当前只有 `create_task` 内嵌校验）
- FastAPI 调试入口保留，AgentCore 入口适配

### 依赖
- 无前序 Unit 依赖（Unit 1 是基础架构）

---

## 执行步骤

### Step 1: 新增 validate_task MCP Tool
- [x] 在 `backend/npc-agent/tools/` 新建 `validate_task.py`
- [x] 封装 `task_validator.validate_task()` 为 `@tool` 格式
- [x] 更新 `tools/__init__.py` 导出新工具

### Step 2: 重构 agent.py 核心逻辑 — 改为 Strands Agent Tool Use 模式
- [x] 移除 `prefetch_all_data()` 函数（不再手动预获取）
- [x] 移除 `call_bedrock_direct()` 函数（不再手动调用 Bedrock）
- [x] 移除 `parse_llm_json()` 函数（Tool Use 模式下 LLM 通过 tools 输出结构化数据）
- [x] 移除 `create_task_from_json()` 函数（改由 LLM 调用 create_task tool）
- [x] 新增 `create_npc_agent()` 函数，使用 Strands Agent SDK 创建 Agent 实例
  - 注册 8 个 tools
  - 配置 BedrockModel provider (Claude Haiku)
- [x] 重写 `handle_npc_dialogue_core()`:
  - 校验 NPC 存在（保留）
  - 构建 system prompt（保留）
  - 调用 Strands Agent `agent(user_message)`
  - 从 Agent messages 提取 tool 调用过程和 task 信息
  - 构建 debug_log

### Step 3: 更新 System Prompt — 适配 Tool Use 模式
- [x] 重写 `prompts/npc_system_prompt.txt`
- [x] 移除"输出 JSON 格式"指令
- [x] 新增 tool 使用工作流指引
- [x] 保留 NPC 人设、任务类型限制、对话要求等核心规则

### Step 4: 适配 FastAPI 调试入口
- [x] 修改 `agent.py` 中的 FastAPI `/agent/dialogue` 端点（Step 2 中已完成）
- [x] 适配新的 Strands Agent 调用方式
- [x] 确保返回格式与 Game Server 期望的 JSON 结构兼容

### Step 5: 适配 AgentCore 生产入口
- [x] 修改 `agentcore_app.py` 中的 `npc_dialogue_handler`
- [x] 添加 `default=str` 处理 JSON 序列化
- [x] 保持与 AgentCore Runtime 的集成

### Step 6: 更新依赖
- [x] 更新 `requirements.txt`，添加 `strands-agents>=1.0.0` 和 `strands-agents-tools>=0.1.0`
- [x] Bedrock model provider 已内置于 strands-agents

### Step 7: 生成 Unit 1 代码摘要文档
- [x] 创建 `aidlc-docs/construction/unit1-mcp-server/code/summary.md`
- [x] 记录所有修改/新建的文件清单
- [x] 记录关键架构决策
