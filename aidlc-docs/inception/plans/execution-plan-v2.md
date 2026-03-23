# 执行计划 V2 — Bug修复、优化与登录功能

## 需求分析
- **请求类型**: Bug修复 + 功能增强 + 新功能（4个具体问题）
- **范围**: 多组件（NPC Agent提示词、前端控制台、延迟优化、登录系统）
- **复杂度**: 中等
- **风险等级**: 低（无基础设施变更，向后兼容）

## 需求清单

### 需求1: 对话框过滤LLM内部文本
- **问题**: 对话框显示"任务创建成功"等LLM内部推理文本
- **方案**: 加强system prompt，明确要求最终回复只能是NPC角色对话，禁止输出工具调用状态等元信息

### 需求2: Console Log标签 + 工具调用优化
- **问题A**: 工具调用显示为绿色"get_player_info"，缺少[MCP Tool]前缀
- **问题B**: 工具调用低效 — get_player_info/events/tasks应从Memory或KB获取，不应调用MCP Tool
- **方案**:
  - 前端Console显示添加`[MCP Tool]`标签
  - 将只读数据（玩家信息、事件、任务）在Python代码中预取，注入到user message
  - LLM只需调用写入工具（create_task）和字典查询工具（get_available_monsters等）[NOTE]:字典查询都从KB取
  - 在Console中显示预取数据来源（Memory/DB）

### 需求3: 延迟优化
- **问题**: 当前NPC对话响应约10秒，5次顺序工具调用每次增加1-2秒
- **方案**: 预取数据消除3次工具调用往返（get_player_info、get_player_events、get_player_tasks），预计节省3-6秒

### 需求4: 登录功能与多角色支持
- **问题**: 需要验证不同玩家有不同的Memory session会话
- **方案**:
  - 将Reset按钮改为Login按钮，前面添加Player ID输入框
  - 输入的ID作为真实player_id（如"1"、"2"）
  - ID=1: 使用当前默认男性勇者形象
  - ID=2: 使用新的女性角色形象（粉色头发、紫色服装）
  - 登录后调用`/api/game/start`注册玩家，重新连接WebSocket

## 执行阶段

### INCEPTION 阶段
- [x] 工作区检测 — 完成（已有项目）
- [x] 需求分析 — 完成（需求清晰，无需提问）
- [x] 工作流规划 — 完成（本文档）
- 用户故事 — 跳过（Bug修复+小功能）
- 应用设计 — 跳过（无新组件）
- 单元拆分 — 跳过（单一工作单元）

### CONSTRUCTION 阶段
- 功能设计 — 跳过（变更明确）
- NFR需求 — 跳过
- NFR设计 — 跳过
- 基础设施设计 — 跳过
- [ ] 代码生成 — 执行（单一单元，7个步骤）
- [ ] 构建和测试 — 执行

## 代码生成计划（单一单元）

### Step 1: 修复System Prompt — 过滤对话中的元信息
- **文件**: `backend/npc-agent/prompts/npc_system_prompt.txt`
- 强化指令：最终回复只能是NPC角色对话，禁止输出"任务创建成功"等内部状态
- 更新工作流程：移除调用get_player_info等只读工具的步骤
- 告知LLM玩家数据已在上下文中提供

### Step 2: 预取数据注入到User Message，减少工具调用
- **文件**: `backend/npc-agent/agent.py`
- 在调用Agent前预取player_info、player_events、player_tasks
- 将数据格式化后注入user_message
- 从AGENT_TOOLS中移除get_player_info、get_player_events、get_player_tasks
- 只保留写入工具（create_task、validate_task）和字典查询工具
- 添加debug_log条目记录预取数据（type: "data_prefetch"）

### Step 3: 前端Console添加[MCP Tool]标签 + 预取数据显示
- **文件**: `frontend/src/scenes/GameScene.js`, `frontend/index.html`
- tool_call类型条目添加`[MCP Tool]`前缀
- 新增data_prefetch类型渲染（显示预取了哪些数据）

### Step 4: 登录界面 — 替换Reset为Login
- **文件**: `frontend/index.html`
- 移除Reset按钮，改为Player ID输入框 + Login按钮
- 输入框默认值为"1"
- 登录后隐藏输入框，显示当前Player ID + Logout按钮

### Step 5: 前端支持动态Player ID
- **文件**: `frontend/src/main.js`, `frontend/src/data/GameData.js`, `frontend/src/entities/Player.js`, `frontend/src/scenes/GameScene.js`
- 游戏启动时从全局变量读取player_id
- Player构造函数接收player_id参数
- 根据player_id选择不同贴图（'player_1' vs 'player_2'）

### Step 6: 生成女性角色贴图
- **文件**: `frontend/src/scenes/BootScene.js`
- 新增generatePlayerTexture2()方法
- 粉色/红色头发 + 紫色服装 + 女性比例的像素画

### Step 7: 部署和测试
- 重建Docker镜像，推送ECR，更新AgentCore
- 重新部署游戏服务器
- 验证：
  - ID=1登录 → 男性角色，NPC对话正常，Console显示[MCP Tool]
  - ID=2登录 → 女性角色，不同的Memory session
  - 对话框无"任务创建成功"文字
  - 响应延迟 < 5秒

## 验收标准
1. 对话框只显示NPC角色对话，无系统/元信息
2. Console log显示`[MCP Tool]`前缀
3. 只读工具不再被LLM调用 — 数据预取注入
4. 响应延迟降至5秒以内 [NOTE]:延迟5s不可接受，要控制在2s内，如streaming、caching、连接预热优化，你看看还有什么办法可以优化。
5. 不同Player ID有不同角色形象和独立Memory session
