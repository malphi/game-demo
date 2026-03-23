# Unit of Work 分解计划

## 计划步骤

- [x] 步骤 1: 定义 4 个工作单元的职责与边界
- [x] 步骤 2: 建立 Unit 间的依赖关系矩阵
- [x] 步骤 3: 映射需求到各 Unit
- [x] 步骤 4: 验证 Unit 边界与依赖完整性

---

## 分解策略

根据需求分析中的 4 项功能需求（FR-1 ~ FR-4），按照依赖关系将系统分解为 4 个有序工作单元。每个 Unit 完成后可独立验证，后续 Unit 在前序 Unit 基础上叠加。

### Unit 概览

| Unit | 名称 | 对应需求 | 核心变更 |
|------|------|---------|---------|
| Unit 1 | MCP Server 架构 | FR-2 | 将 NPC Agent 重构为 MCP Server，封装 8 个 tools，改为 Tool Use 模式 |
| Unit 2 | Knowledge Base 集成 | FR-3 | 字典数据（怪物/道具/NPC）迁移到 Bedrock KB，MCP tools 改为 KB 查询 |
| Unit 3 | AgentCore Memory 集成 | FR-1 | 集成 Memory 组件，实现短期/长期记忆，session 管理 |
| Unit 4 | 延迟优化 | FR-4 | Streaming 输出、Prompt Caching、连接预热、前端适配 |

---

## 问题

### Question 1
Unit 1 (MCP Server) 重构时，NPC Agent 的 HTTP 入口（FastAPI）是否保留，还是完全替换为 AgentCore + MCP 模式？

A) 完全替换为 AgentCore + MCP 模式，移除 FastAPI HTTP 入口
B) 保留 FastAPI 作为本地调试入口，AgentCore + MCP 为生产模式
C) Other (please describe after [Answer]: tag below)

[Answer]:B

### Question 2
Unit 4 (延迟优化) 中的 streaming 输出，Game Server 到前端的 WebSocket 消息格式需要变更。您希望如何处理？

A) 新增 `npc_dialogue_stream` 消息类型（流式分块），保留原有 `npc_dialogue_response`（完整响应）做兼容
B) 直接修改现有 `npc_dialogue_response` 为流式模式，前端适配新协议
C) Other (please describe after [Answer]: tag below)

[Answer]: B
