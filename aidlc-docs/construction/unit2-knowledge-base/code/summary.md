# Unit 2: Knowledge Base 集成 — 代码变更摘要

## 变更文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `backend/npc-agent/kb-data/monsters.md` | 新建 | 怪物字典 KB 数据源（5 怪物） |
| `backend/npc-agent/kb-data/items.md` | 新建 | 道具字典 KB 数据源（23 道具，按类型分组） |
| `backend/npc-agent/kb-data/npcs.md` | 新建 | NPC 字典 KB 数据源（4 NPC） |
| `backend/npc-agent/kb-data/task_rules.md` | 新建 | 任务生成规则与奖励指南 |
| `backend/npc-agent/kb_client.py` | 新建 | KB 查询客户端，封装 Retrieve API |
| `backend/npc-agent/tools/get_monsters.py` | 重写 | 优先 KB 查询，DynamoDB 作为 fallback |
| `backend/npc-agent/tools/get_items.py` | 重写 | 优先 KB 查询，DynamoDB 作为 fallback |
| `backend/npc-agent/tools/get_npcs.py` | 重写 | 优先 KB 查询，DynamoDB 作为 fallback |
| `infra/kb-sync.py` | 新建 | 从 seed_data.py 自动生成 KB Markdown 文件 |
| `infra/kb-setup.py` | 新建 | KB 部署指导脚本（S3 + IAM + KB 创建） |

## 架构变更

### Before (DynamoDB Scan)
```
get_available_monsters() -> DynamoDB.Table("Monsters").scan() -> list[dict]
get_available_items()    -> DynamoDB.Table("Items").scan()    -> list[dict]
get_available_npcs()     -> DynamoDB.Table("NPCs").scan()     -> list[dict]
```

### After (KB 检索 + DynamoDB Fallback)
```
get_available_monsters()
  -> kb_client.query_knowledge_base("怪物全量列表") -> str (KB 文本)
  -> [fallback] DynamoDB.Table("Monsters").scan()  -> list[dict]

get_available_items()
  -> kb_client.query_knowledge_base("道具全量列表") -> str (KB 文本)
  -> [fallback] DynamoDB.Table("Items").scan()     -> list[dict]

get_available_npcs()
  -> kb_client.query_knowledge_base("NPC全量列表") -> str (KB 文本)
  -> [fallback] DynamoDB.Table("NPCs").scan()      -> list[dict]
```

## 关键决策

- **嵌入模型**: Amazon Titan Text Embeddings V2 (`amazon.titan-embed-text-v2:0`)，256 维
- **Retrieve API**: 使用 `bedrock-agent-runtime.retrieve()`，直接返回文本给 Strands Agent 的 LLM 解读
- **Fallback 策略**: KB 不可用时自动回退到 DynamoDB Scan，确保系统可用性
- **KB 数据格式**: 结构化 Markdown，便于语义索引和人类可读
- **返回类型变化**: KB 模式返回 `str`（拼接的文本），DynamoDB 模式返回 `list[dict]`，LLM 均可处理
- **KB 部署**: 建议通过 Bedrock Console 快速创建（自动配置 OpenSearch Serverless），脚本提供 S3 上传和指导

## 新增环境变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `BEDROCK_KB_ID` | Bedrock Knowledge Base ID | 空（空时 fallback 到 DynamoDB） |

## KB 部署流程

1. `python infra/kb-sync.py` — 从 seed_data.py 生成 KB 数据文件
2. 在 Bedrock Console 创建 Knowledge Base（使用 Titan Embeddings V2，quick-create）
3. 上传 `backend/npc-agent/kb-data/*.md` 到 KB 的 S3 数据源
4. 在 Console 触发数据同步（Start Sync）
5. 设置环境变量 `BEDROCK_KB_ID=<kb-id>`
