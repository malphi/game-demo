# Unit 3: AgentCore Memory 集成 — 代码变更摘要

## 变更文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `backend/npc-agent/memory_config.py` | 新建 | Memory Session Manager 创建逻辑 |
| `backend/npc-agent/agent.py` | 修改 | 集成 session_manager，支持有状态对话 |
| `backend/npc-agent/prompts/npc_system_prompt.txt` | 修改 | 添加对话记忆提示 |
| `infra/memory-setup.py` | 新建 | Memory 资源创建脚本 |

## 架构变更

### Before (无状态)
```
handle_npc_dialogue_core(player_id, npc_id)
  -> create_npc_agent(system_prompt)          # 每次全新 Agent，无记忆
  -> agent(user_message)                       # 单次对话，无历史上下文
```

### After (有状态 + Memory)
```
handle_npc_dialogue_core(player_id, npc_id)
  -> create_session_manager(player_id, npc_id) # 创建 Memory Session
  -> with session_manager as sm:               # 上下文管理器确保 flush
       -> create_npc_agent(system_prompt, sm)  # Agent 绑定 Memory
       -> agent(user_message)                  # 自动加载历史对话 + 长期记忆
                                               # 对话完成后自动保存到 Memory
```

## 数据隔离架构

```
Memory Resource (AGENTCORE_MEMORY_ID, 全局共享)
  └── Actor: player_001 (actor_id = player_id)
  │    ├── Session: player_001_npc_elder      → 对话历史（短期记忆）
  │    ├── Session: player_001_npc_blacksmith  → 对话历史（短期记忆）
  │    ├── /facts/player_001/                  → 游戏事实（长期记忆）
  │    └── /preferences/player_001/            → 玩家偏好（长期记忆）
  └── Actor: player_002
       ├── Session: player_002_npc_elder
       ├── /facts/player_002/
       └── /preferences/player_002/
```

## 关键决策

- **Strands 原生集成**: 使用 `Agent(session_manager=...)` 参数，无需手动管理事件读写
- **上下文管理器**: 使用 `with session_manager as sm:` 确保对话结束时缓冲区正确 flush
- **优雅退化**: `AGENTCORE_MEMORY_ID` 未设置时返回 None，Agent 退化为无状态模式
- **Session 策略**: session_id = `{player_id}_{npc_id}`，每个玩家-NPC 对独立会话
- **长期记忆策略**:
  - SemanticStrategy (PlayerFactExtractor): 提取游戏事实
  - UserPreferenceStrategy (PlayerPreferenceLearner): 提取玩家偏好
- **无需修改 agentcore_app.py**: Memory 逻辑完全封装在 `handle_npc_dialogue_core()` 内部
- **无需额外依赖**: `bedrock-agentcore>=0.1.0` 已包含 memory 模块

## 新增环境变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `AGENTCORE_MEMORY_ID` | AgentCore Memory 资源 ID | 空（空时退化为无状态） |

## Memory 部署流程

1. `pip install bedrock-agentcore` — 安装依赖
2. `python infra/memory-setup.py --region us-west-2` — 创建 Memory 资源（约 2-3 分钟）
3. 设置环境变量 `AGENTCORE_MEMORY_ID=<memory-id>`
4. 重启 NPC Agent 服务
