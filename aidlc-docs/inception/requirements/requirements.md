# 需求文档

## 意图分析

- **用户需求**: 对现有游戏 Demo 的 NPC Agent 进行 4 项重大增强：AgentCore Memory 实现有状态对话、MCP Tool 架构封装游戏功能、Bedrock Knowledge Base 存储字典数据、LLM 推理延迟优化。
- **需求类型**: 功能增强（跨多个组件改进现有功能）
- **影响范围**: 多组件（NPC Agent、Game Server、基础设施）
- **复杂度评估**: 复杂

---

## 功能需求

### FR-1: AgentCore Memory 实现有状态 NPC 对话

**描述**: 集成 AgentCore 内置的 Memory 组件，实现玩家与 NPC 之间的有状态对话。同一个玩家调用 NPC Agent 时应保持同一个 session 会话上下文。

**短期记忆**（每次会话/交互刷新）:
- 玩家基本信息（名称、等级、HP、攻击力、防御力、金币）
- 实时状态（当前 HP 百分比、激活的增益效果、装备情况）
- 上一次行为事件（最近一次战斗结果、道具使用、任务完成情况）

**长期记忆**（跨会话持久化）:
- 过去 20 次行为事件（战斗历史、道具获取、任务完成记录）
- 玩家偏好（偏好的任务类型、常访问的 NPC、游玩模式）
- 玩家成长里程碑（达到的等级、重要成就）

**关键行为**:
- 同一 player_id 始终映射到同一个 session/memory 上下文
- 每次 LLM 调用前加载 Memory 并注入对话上下文
- 短期记忆在每次交互时刷新
- 长期记忆随时间累积，跨对话持久化

### FR-2: MCP Server 架构封装游戏功能

**描述**: 将 NPC Agent 重构为完整的 MCP（Model Context Protocol）Server 架构。所有游戏功能都封装为 MCP tools，由 LLM 自主决定调用。

**需实现的 MCP Tools**:

| Tool 名称 | 功能描述 | 当前实现 |
|-----------|---------|---------|
| `get_player_info` | 查询玩家状态（等级、HP、背包等） | `tools/get_player_info.py` |
| `get_player_events` | 查询玩家最近行为事件 | `tools/get_player_events.py` |
| `get_player_tasks` | 查询玩家当前任务列表 | `tools/get_player_tasks.py` |
| `get_monsters` | 查询怪物字典 | `tools/get_monsters.py`（FR-3 后改为 KB 查询） |
| `get_items` | 查询道具字典 | `tools/get_items.py`（FR-3 后改为 KB 查询） |
| `get_npcs` | 查询 NPC 字典 | `tools/get_npcs.py`（FR-3 后改为 KB 查询） |
| `create_task` | 创建并校验新任务 | `tools/create_task.py` + `validation/task_validator.py` |
| `validate_task` | 仅校验任务数据，不创建 | `validation/task_validator.py` |

**相比当前架构的关键变化**:
- 当前: 预获取所有数据 + 单次 LLM 调用（无 Tool Use）
- 目标: MCP Server 暴露 tools，LLM 通过 Tool Use 模式自主决定调用哪些工具
- Agent 从确定性的预获取模式转变为 LLM 驱动的工具调用模式

### FR-3: Bedrock Knowledge Base 存储字典数据

**描述**: 将游戏静态字典数据（NPC 表、道具表、怪物表）以知识库（Knowledge Base）形式保存到 Amazon Bedrock，供模型推理时调用。

**存入 Knowledge Base 的数据**:
- 怪物字典（monster_id、name、level、hp、attack、defense、exp_reward、gold_reward、drop_items）
- 道具字典（item_id、name、description、type、sub_type、effect）
- NPC 字典（npc_id、name、role、personality、position）
- 奖励规则与任务生成指南

**仍保留在 DynamoDB 中的数据**（动态、玩家相关）:
- 玩家数据（Players 表）
- 玩家任务（Tasks 表）
- 玩家行为日志（PlayerEventSummary 表）

**关键行为**:
- KB 查询替代 LLM 推理时对字典表的 DynamoDB Scan 操作
- 字典数据经过索引支持语义搜索（如"查找适合 3 级玩家的怪物"）
- KB 数据在游戏字典变更时更新（低频率）

### FR-4: LLM 推理延迟优化

**描述**: 通过多种组合优化策略降低 LLM 推理的实际延迟和感知延迟。当前调用 Haiku 模型延迟约 3 秒。

**优化策略**:

| 策略 | 描述 | 预期效果 |
|-----|------|---------|
| Prompt Caching | 缓存 System Prompt（NPC 人设 + 任务规则），跨请求复用 | 减少约 50% 输入 token 处理耗时 |
| Prompt 精简 | 利用 KB 承载字典数据，进一步缩减 prompt 体积 | 输入 token 从 ~550 降至 ~200 |
| 流式输出（Streaming） | 使用 streaming response，对话文本边生成边展示 | 感知延迟降至首 token 时间（~500ms） |
| 连接预热 | 预建立 Bedrock API 连接，复用 HTTP/2 长连接 | 减少连接开销约 200ms |

**目标**: 综合优化后，感知延迟从 ~3s 降至首次可见输出 <1s。

---

## 非功能需求

### NFR-1: 性能
- LLM 首 token 输出: 通过 streaming 实现感知延迟 < 1 秒
- 整体对话生成: 端到端总耗时 < 3 秒
- Memory 加载/保存操作: < 200ms

### NFR-2: 兼容性
- 无需离线/本地开发模式（仅 AWS 模式）
- 必须保持与现有前端 WebSocket 协议的向后兼容
- 必须保持现有任务校验规则和游戏平衡性

### NFR-3: 数据一致性
- 短期记忆必须始终反映当前玩家状态
- 长期记忆可接受最终一致性（延迟不超过 1 次交互）
- KB 字典数据必须与 DynamoDB 种子数据一致

### NFR-4: 安全性
- 安全扩展规则: **已禁用**（本项目为 Demo/原型项目）
- 仍遵循基本安全实践（不硬编码凭据、使用参数化查询）

---

## 技术决策

| 决策项 | 选择 | 理由 |
|-------|------|-----|
| Memory 实现方式 | AgentCore 内置 Memory 组件 | 与 AgentCore 运行时原生集成，无需自定义实现 |
| 工具架构 | 完整 MCP Server | 所有游戏功能作为 MCP tools，LLM 自主决定工具调用 |
| Knowledge Base 范围 | 仅静态字典数据 | 动态玩家数据保留在 DynamoDB 以保证实时准确性 |
| 延迟优化 | 综合方案 | Prompt Caching + 精简 prompt + streaming 输出 + 连接预热 |
| 离线模式 | 不需要 | 仅 AWS 部署简化实现 |
| 安全规则 | 已禁用 | Demo/原型项目，非生产级别 |

---

## 架构影响概述

```
当前架构:
  玩家 -> Game Server -> AgentCore -> NPC Agent
  NPC Agent: 预获取 6 张 DynamoDB 表 -> 构建 prompt -> 单次 LLM 调用 -> 解析 JSON -> 校验 -> 写入任务

目标架构:
  玩家 -> Game Server -> AgentCore -> NPC Agent (集成 Memory + MCP + KB)
  NPC Agent:
    1. 加载 Memory（短期记忆 + 长期记忆）获取玩家 session 上下文
    2. LLM 接收来自 Memory + KB 的上下文信息
    3. LLM 自主调用 MCP tools（get_player_info、get_monsters、create_task 等）
    4. Streaming 流式响应回传到前端
    5. 交互结果更新 Memory
```
