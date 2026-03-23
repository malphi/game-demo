# Unit of Work 依赖关系

## 依赖矩阵

| Unit | 依赖 | 被依赖 | 关系说明 |
|------|------|--------|---------|
| Unit 1: MCP Server 架构 | 无 | Unit 2, 3, 4 | 基础架构，所有后续 Unit 在此基础上构建 |
| Unit 2: Knowledge Base 集成 | Unit 1 | Unit 4 | 依赖 MCP tools 框架；KB 查询减少 prompt 体积供 Unit 4 优化 |
| Unit 3: AgentCore Memory 集成 | Unit 1 | Unit 4 | 依赖 MCP 架构的 Agent 入口；Memory 上下文供 Unit 4 优化 |
| Unit 4: 延迟优化 | Unit 1, 2, 3 | 无 | 在完整架构上应用端到端优化 |

## 依赖图

```
Unit 1: MCP Server 架构
    |
    +---> Unit 2: Knowledge Base 集成
    |         |
    +---> Unit 3: AgentCore Memory 集成
    |         |
    +---------+--> Unit 4: 延迟优化
```

## 执行顺序

```
Unit 1 (MCP Server) --> Unit 2 (KB) --> Unit 3 (Memory) --> Unit 4 (Latency)
```

**说明**: Unit 2 和 Unit 3 理论上可以并行执行（彼此无直接依赖），但为降低集成风险，建议顺序执行。Unit 4 必须最后执行，因为 streaming 和 caching 需要在完整架构上应用。

## 集成验证点

| 验证点 | 时机 | 验证内容 |
|--------|------|---------|
| VP-1 | Unit 1 完成后 | MCP tools 可正常调用，Tool Use 模式下 LLM 能自主选择工具 |
| VP-2 | Unit 2 完成后 | KB 查询返回正确字典数据，与 DynamoDB 种子数据一致 |
| VP-3 | Unit 3 完成后 | Memory 跨对话持久化，同一玩家可恢复上下文 |
| VP-4 | Unit 4 完成后 | 端到端流式输出正常，感知延迟 < 1s |
