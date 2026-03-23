# Requirements Verification Questions

Please answer the following questions to help clarify the requirements. Fill in the letter choice after each [Answer]: tag.

---

## Question 1
关于 AgentCore Memory 组件的使用，您希望如何实现玩家session管理？

A) 使用 AgentCore 内置的 Memory 组件（如果AgentCore SDK原生支持session memory）
B) 在 NPC Agent 中自行实现 Memory 层，使用 DynamoDB 存储短期/长期记忆
C) 使用 Amazon Bedrock 的 Session Management 功能（如果可用）
D) Other (please describe after [Answer]: tag below)

[Answer]:A

---

## Question 2
关于 MCP Tool 的封装，您希望 NPC Agent 如何调用这些 tools？

A) 改为 Bedrock Tool Use 模式（多轮工具调用），LLM 自主决定调用哪些 tools
B) 保持当前的预获取数据+单次LLM调用架构，仅将 create_task 和 task_validation 封装为 MCP tools
C) 完全改为 MCP Server 架构，所有游戏功能（查询玩家、查询字典、创建任务等）都作为 MCP tools
D) Other (please describe after [Answer]: tag below)

[Answer]:C

---

## Question 3
关于知识库（Knowledge Base），您希望字典表数据如何组织？

A) 将所有字典数据（NPC表、道具表、怪物表、奖励规则）合并为一个 Knowledge Base
B) 每类字典数据创建独立的 Knowledge Base（NPC KB、道具 KB、怪物 KB）
C) 只将相对静态的字典数据放入 KB（NPC、道具、怪物），动态数据（玩家任务）仍从 DynamoDB 查询
D) Other (please describe after [Answer]: tag below)

[Answer]:C

---

## Question 4
关于 LLM 推理延迟优化（目前 ~3s），您期望的目标延迟是多少？

A) 1-2 秒（通过 Prompt Caching + 精简 prompt 优化）
B) < 1 秒（可能需要更换为更快的模型如 Haiku 4.5 或使用 streaming）
C) 采用 streaming 流式输出，让用户感知延迟更短（实际推理时间可能不变）
D) 综合使用多种优化手段（Prompt Caching + 精简 prompt + streaming 输出 + 预热连接）
E) Other (please describe after [Answer]: tag below)

[Answer]:D

---

## Question 5
改造后的 NPC Agent 架构，是否仍需要支持离线模式（无 AWS 依赖的本地开发模式）？

A) 是，必须保留离线开发模式，新功能（Memory、MCP、KB）需要有本地降级方案
B) 否，改造后只需要支持完整的 AWS 模式即可
C) Other (please describe after [Answer]: tag below)

[Answer]:B

---

## Question 6: Security Extensions
Should security extension rules be enforced for this project?

A) Yes - enforce all SECURITY rules as blocking constraints (recommended for production-grade applications)
B) No - skip all SECURITY rules (suitable for PoCs, prototypes, and experimental projects)
C) Other (please describe after [Answer]: tag below)

[Answer]:B

---
