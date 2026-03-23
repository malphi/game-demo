# Unit 2: Knowledge Base 集成 - Code Generation Plan

## Unit 上下文

### 需求映射
- **FR-3**: Bedrock Knowledge Base 存储字典数据

### 当前状态
- 3 个字典查询工具（get_monsters, get_items, get_npcs）均通过 DynamoDB Scan 获取全量数据
- `infra/seed_data.py` 是字典数据的权威来源（5 怪物、4 NPC、23 道具）
- Unit 1 已完成 MCP Server 架构，工具使用 `@tool` 装饰器，LLM 通过 Tool Use 调用

### 关键发现
- 字典数据量小（共 32 条记录），非常适合 KB 语义检索
- 现有 tools 直接 `table.scan()` 返回全量数据，需改为 KB `RetrieveAndGenerate` 或 `Retrieve` API
- KB 数据源文件需要结构化的 Markdown/JSON 格式便于嵌入索引
- 需要 KB 配置脚本来创建 Knowledge Base、Data Source、并触发同步

### 依赖
- Unit 1 (MCP Server 架构) — 已完成

---

## 执行步骤

### Step 1: 创建 KB 数据源文件 — 怪物字典
- [x] 在 `backend/npc-agent/kb-data/` 目录新建 `monsters.md`
- [x] 从 `infra/seed_data.py` 的 MONSTERS 数据生成结构化 Markdown
- [x] 包含所有字段：monster_id, name, level, hp, attack, defense, exp_reward, gold_reward, drop_items, sprite
- [x] 使用清晰的标题和表格格式便于语义索引

### Step 2: 创建 KB 数据源文件 — 道具字典
- [x] 在 `backend/npc-agent/kb-data/` 目录新建 `items.md`
- [x] 从 `infra/seed_data.py` 的 ITEMS 数据生成结构化 Markdown
- [x] 按类型分组：consumable, equipment(weapon/armor/accessory), material, gift_pack
- [x] 包含所有字段：item_id, name, description, type, sub_type, effect, sprite

### Step 3: 创建 KB 数据源文件 — NPC 字典
- [x] 在 `backend/npc-agent/kb-data/` 目录新建 `npcs.md`
- [x] 从 `infra/seed_data.py` 的 NPCS 数据生成结构化 Markdown
- [x] 包含所有字段：npc_id, name, role, personality, position_x, position_y, sprite

### Step 4: 创建 KB 数据源文件 — 奖励规则与任务指南
- [x] 在 `backend/npc-agent/kb-data/` 目录新建 `task_rules.md`
- [x] 从 `design.md` 和 `prompts/npc_system_prompt.txt` 提取任务生成规则
- [x] 包含：任务类型定义、各NPC可发布的任务类型、怪物等级匹配规则、奖励规则

### Step 5: 创建 KB 数据同步脚本
- [x] 新建 `infra/kb-sync.py`
- [x] 功能：从 `infra/seed_data.py` 中的 MONSTERS/NPCS/ITEMS 数据自动生成 KB 数据源 Markdown 文件
- [x] 支持参数：输出目录
- [x] 确保与手动创建的数据源文件格式一致

### Step 6: 创建 KB 配置与部署脚本
- [x] 新建 `infra/kb-setup.py`
- [x] 功能：
  - 创建 S3 Bucket 存放 KB 数据源文件
  - 上传 `kb-data/*.md` 到 S3
  - 创建 Bedrock Knowledge Base（使用 Amazon Titan Embeddings v2）
  - 创建 S3 Data Source 并关联到 KB
  - 触发 KB 数据同步（StartIngestionJob）
- [x] 支持参数：region, env, bucket-name
- [x] 输出 KB ID 供工具引用

### Step 7: 创建 KB 查询辅助模块
- [x] 新建 `backend/npc-agent/kb_client.py`
- [x] 封装 Bedrock Agent Runtime `Retrieve` API 调用
- [x] 函数 `query_knowledge_base(query: str, kb_id: str, max_results: int) -> list`
- [x] 返回检索到的文本内容列表
- [x] KB ID 从环境变量 `BEDROCK_KB_ID` 读取

### Step 8: 重构 get_monsters 工具 — 改为 KB 查询
- [x] 修改 `backend/npc-agent/tools/get_monsters.py`
- [x] 将 DynamoDB Scan 替换为 KB Retrieve 调用
- [x] 查询关键词："所有怪物 monsters 全量列表"（确保返回全部数据）
- [x] 保持 `@tool` 装饰器和函数签名不变
- [x] 添加 fallback: KB 查询失败时回退到 DynamoDB Scan

### Step 9: 重构 get_items 工具 — 改为 KB 查询
- [x] 修改 `backend/npc-agent/tools/get_items.py`
- [x] 将 DynamoDB Scan 替换为 KB Retrieve 调用
- [x] 保持 `@tool` 装饰器和函数签名不变
- [x] 添加 fallback: KB 查询失败时回退到 DynamoDB Scan

### Step 10: 重构 get_npcs 工具 — 改为 KB 查询
- [x] 修改 `backend/npc-agent/tools/get_npcs.py`
- [x] 将 DynamoDB Scan 替换为 KB Retrieve 调用
- [x] 保持 `@tool` 装饰器和函数签名不变
- [x] 添加 fallback: KB 查询失败时回退到 DynamoDB Scan

### Step 11: 更新依赖与环境配置
- [x] 确认 `requirements.txt` 中 `boto3>=1.35.0` 已支持 Bedrock Agent Runtime API
- [x] 在 `agent.py` 中添加 `BEDROCK_KB_ID` 环境变量读取（如需要）— KB ID 由 kb_client.py 通过环境变量读取，agent.py 无需修改
- [x] 更新 `.env.example` 或文档说明新增的环境变量 — 在 summary.md 中记录

### Step 12: 生成 Unit 2 代码摘要文档
- [x] 创建 `aidlc-docs/construction/unit2-knowledge-base/code/summary.md`
- [x] 记录所有修改/新建的文件清单
- [x] 记录关键架构决策
- [x] 说明 KB 部署流程
