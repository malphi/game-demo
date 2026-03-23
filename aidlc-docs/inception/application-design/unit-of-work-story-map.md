# Unit of Work 需求映射

## 需求到 Unit 映射

| 需求 | Unit | 映射说明 |
|------|------|---------|
| FR-1: AgentCore Memory 有状态对话 | Unit 3 | Memory 集成为独立 Unit，依赖 MCP 架构 |
| FR-2: MCP Server 架构封装游戏功能 | Unit 1 | 基础架构 Unit，所有 tools 封装 |
| FR-3: Bedrock KB 存储字典数据 | Unit 2 | KB 集成为独立 Unit，字典 tools 迁移 |
| FR-4: LLM 推理延迟优化 | Unit 4 | 端到端优化，依赖全部前序 Unit |
| NFR-1: 性能（首 token < 1s） | Unit 4 | streaming + caching 实现 |
| NFR-2: 兼容性（WebSocket 协议） | Unit 4 | 修改 npc_dialogue_response 为流式 |
| NFR-3: 数据一致性 | Unit 2, 3 | KB 数据一致 + Memory 一致 |

## Unit 详细需求覆盖

### Unit 1: MCP Server 架构
- [FR-2] 8 个 MCP tools 实现
- [FR-2] Tool Use 模式（多轮工具调用）
- [FR-2] FastAPI 调试入口 + AgentCore 生产入口

### Unit 2: Knowledge Base 集成
- [FR-3] 怪物/道具/NPC 字典数据存入 KB
- [FR-3] get_monsters/get_items/get_npcs 改为 KB 查询
- [NFR-3] KB 数据与 DynamoDB 种子数据一致

### Unit 3: AgentCore Memory 集成
- [FR-1] 短期记忆: 玩家基本信息 + 实时状态 + 上次行为
- [FR-1] 长期记忆: 20 次历史事件 + 玩家偏好
- [FR-1] Session 管理: player_id -> session 映射
- [NFR-3] Memory 数据一致性

### Unit 4: 延迟优化
- [FR-4] Bedrock converse_stream 流式调用
- [FR-4] Prompt Caching（System Prompt 缓存）
- [FR-4] Prompt 精简（利用 KB 减少输入 token）
- [FR-4] 连接预热（Bedrock client 复用）
- [NFR-1] 感知延迟 < 1s
- [NFR-2] 修改 npc_dialogue_response 为流式模式
