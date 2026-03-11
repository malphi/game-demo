# 项目架构分析文档

## 1. 项目概述

本项目是一个 AI 驱动的 2D RPG 网页游戏 Demo，核心亮点是 NPC 通过大模型（Amazon Bedrock Claude）动态生成任务，而非使用预设的静态任务池。玩家通过键盘操控角色，在场景中与怪物战斗、与 NPC 对话并接取任务。

---

## 2. 部署架构

### 2.1 架构总览

```
Frontend (Phaser.js / Vite:3000)
    ↓ WebSocket + REST
Game Server (Express + WS:8080, Docker/EC2)
    ↓ POST /agent/dialogue (AgentCore SDK)
NPC Agent (FastAPI:8090, Docker / AgentCore Runtime)
    ↓ boto3
Amazon Bedrock (Claude 3.5 Haiku)
    ↓
DynamoDB (6张表) + Kinesis Data Stream + S3
```

### 2.2 运行模式

| 模式 | 说明 | AWS 依赖 |
|------|------|----------|
| 离线模式 | 前端 + Game Server（内存存储），NPC 使用规则生成对话 | 无 |
| 完整模式 | 前端 + Game Server（DynamoDB）+ NPC Agent + Bedrock | DynamoDB、Bedrock、Kinesis、S3 |

### 2.3 容器化

| Dockerfile | 基础镜像 | 用途 |
|------------|---------|------|
| `backend/game-server/Dockerfile` | node:20-alpine | Game Server 容器，端口 8080 |
| `backend/npc-agent/Dockerfile` | python:3.12-slim | NPC Agent 本地开发容器，端口 8090 |
| `backend/npc-agent/Dockerfile.agentcore` | python:3.12-slim | NPC Agent AgentCore Runtime 生产容器 |

### 2.4 生产环境部署拓扑

- 前端：S3 + CloudFront CDN
- Game Server：EC2（VPC 私有子网）+ ALB
- NPC Agent：AWS Bedrock AgentCore Runtime
- 数据层：DynamoDB 6 张表、Kinesis Data Stream、S3 日志归档

---

## 3. 技术栈

### 3.1 前端

| 技术 | 版本 | 用途 |
|------|------|------|
| Phaser | 3.80.1 | 2D 游戏引擎（Arcade 物理，800×600 画布） |
| Vite | 5.4.0 | 构建工具 |
| WebSocket API | 原生 | 实时通信 |

### 3.2 Game Server

| 技术 | 版本 | 用途 |
|------|------|------|
| Node.js | 20 | 运行时 |
| Express | 4.21.0 | HTTP 框架 |
| ws | 8.18.0 | WebSocket 服务 |
| @aws-sdk/client-dynamodb | 3.600.0 | DynamoDB 读写 |
| @aws-sdk/client-bedrock-agentcore | 3.1000.0 | 调用 NPC Agent |
| uuid | 10.0.0 | 唯一 ID 生成 |

### 3.3 NPC Agent

| 技术 | 版本 | 用途 |
|------|------|------|
| Python | 3.12 | 运行时 |
| FastAPI | 0.115.0 | HTTP 框架 |
| boto3 | 1.35.0 | AWS SDK（DynamoDB + Bedrock） |
| bedrock-agentcore | 0.1.0 | AgentCore Runtime 集成 |
| pydantic | 2.0.0 | 数据校验 |
| LLM 模型 | Claude 3.5 Haiku | `us.anthropic.claude-3-5-haiku-20241022-v1:0` |

### 3.4 数据层

| 服务 | 用途 |
|------|------|
| DynamoDB | 6 张表：Players、Tasks、PlayerEventSummary、Monsters、NPCs、Items |
| Kinesis Data Stream | 玩家行为事件流 |
| S3 | 前端静态资源 + 日志归档 |

---

## 4. 前后端通讯

### 4.1 WebSocket（实时游戏交互，ws://host:8080/ws）

#### 客户端 → 服务端

| 消息类型 | 参数 | 用途 |
|---------|------|------|
| `battle_start` | `{player_id, monster_id}` | 发起战斗 |
| `npc_dialogue_start` | `{player_id, npc_id}` | 发起 NPC 对话 |
| `task_accept` | `{player_id, task_id}` | 接受任务 |
| `task_reject` | `{player_id, task_id}` | 拒绝任务 |
| `use_item` | `{player_id, item_id}` | 使用道具 |
| `player_move` | `{player_id, x, y}` | 同步位置 |
| `ping` | `{}` | 心跳 |

#### 服务端 → 客户端

| 消息类型 | 用途 |
|---------|------|
| `battle_start` | 战斗开始确认 |
| `battle_round` | 逐回合伤害/血量更新 |
| `battle_end` | 战斗结果（胜利/失败 + 奖励） |
| `npc_dialogue_response` | NPC 对话文本 + 任务数据 + 调试日志 |
| `task_progress` | 任务条件进度更新 |
| `task_completed` | 任务完成 + 奖励 |

### 4.2 REST API（端口 8080/api）

| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| POST | `/api/game/start` | 开始游戏会话 |
| POST | `/api/player/create` | 创建玩家 |
| GET | `/api/player/:id` | 获取玩家数据 |
| GET | `/api/tasks/:playerId` | 获取任务列表 |
| POST | `/api/tasks/:taskId/complete` | 完成任务 |
| GET | `/api/dict/monsters` | 怪物字典 |
| GET | `/api/dict/npcs` | NPC 字典 |
| GET | `/api/dict/items` | 道具字典 |

### 4.3 连接策略

- 本地开发：`ws://localhost:8080/ws`（Vite 端口 3000/3001 时直连 8080）
- 生产环境：`wss://host/ws`（通过 CloudFront/ALB 代理）
- 连接失败时自动降级为离线模式

### 4.4 服务间通讯

| 链路 | 协议 | 说明 |
|------|------|------|
| Game Server → NPC Agent | AgentCore SDK / HTTP POST | NPC 对话生成 |
| Game Server → DynamoDB | AWS SDK | 玩家/任务/事件持久化 |
| NPC Agent → DynamoDB | boto3 | 数据预取（6 张表） |
| NPC Agent → Bedrock | boto3 | LLM 推理 |
| EventEmitter → Kinesis | AWS SDK | 行为事件流 |

---

## 5. 模块详解与调用关系

### 5.1 前端模块

```
main.js                          # Phaser 游戏入口，注册 4 个场景
├── scenes/
│   ├── BootScene.js             # 资源预加载（贴图、音效）
│   ├── GameScene.js             # 主场景（1600×1200），玩家移动、碰撞检测
│   ├── BattleScene.js           # 回合制战斗覆盖层
│   └── UIScene.js               # HUD（血条、背包、任务面板）
├── entities/
│   ├── Player.js                # 玩家实体（Sprite + 移动 + 碰撞）
│   ├── Monster.js               # 怪物实体
│   └── NPC.js                   # NPC 实体
├── network/
│   └── WebSocketClient.js       # WebSocket 通信封装、消息路由、离线降级
└── data/
    └── GameData.js              # 内存字典缓存，启动时从后端同步
```

**场景流转：** BootScene（加载资源）→ GameScene（主世界）⇄ BattleScene（战斗时覆盖）+ UIScene（常驻 HUD）

### 5.2 Game Server 模块

```
src/index.js                     # 入口：Express HTTP + WebSocket 服务器
├── handlers/                    # 消息处理层
│   ├── session.js               # 游戏开始/存档，创建玩家
│   ├── battle.js                # 战斗消息处理，调用 BattleSystem
│   ├── npc.js                   # NPC 对话处理，调用 AgentCore/NPC Agent
│   └── task.js                  # 任务完成、道具使用处理
├── services/                    # 业务逻辑层
│   ├── BattleSystem.js          # 回合制战斗引擎（伤害=max(攻击-防御,1)）
│   ├── PlayerDataService.js     # 玩家 CRUD（内存/DynamoDB 双模式）
│   ├── TaskManager.js           # 任务校验、创建、进度追踪、完成结算
│   ├── InventoryManager.js      # 背包管理（添加/移除/使用/装备/开礼包）
│   └── EventEmitter.js          # 行为事件日志（内存 + DynamoDB + Kinesis）
├── models/                      # 数据字典层
│   ├── Monster.js               # 5 种怪物（slime_01 ~ dragon_01）
│   ├── NPC.js                   # 5 个 NPC（村长、铁匠、商人、药师、斥候）
│   ├── Item.js                  # 40+ 道具（消耗品、装备、材料、礼包）
│   ├── Player.js                # 玩家数据结构 + 升级逻辑
│   └── Task.js                  # 任务数据结构 + 条件类型定义
└── seed.js                      # 字典数据初始化脚本
```

### 5.3 NPC Agent 模块

```
agent.py                         # FastAPI 主入口，POST /agent/dialogue
├── agentcore_app.py             # AgentCore Runtime 入口（生产环境）
├── db_config.py                 # DynamoDB 连接配置（本地/云端切换）
├── prompts/
│   └── npc_system_prompt.txt    # LLM 系统提示词模板（NPC 人格 + 任务规则）
├── validation/
│   └── task_validator.py        # 任务校验器（7 项校验规则）
└── tools/                       # 数据获取工具
    ├── get_player_info.py       # 查询玩家信息
    ├── get_player_events.py     # 查询玩家行为事件
    ├── get_player_tasks.py      # 查询玩家任务
    ├── get_monsters.py          # 查询怪物字典
    ├── get_items.py             # 查询道具字典
    ├── get_npcs.py              # 查询 NPC 字典
    └── create_task.py           # 创建任务（含校验）
```

### 5.4 核心调用链

#### 战斗流程

```
玩家碰撞怪物 → GameScene 碰撞检测
  → WebSocketClient.send({type: "battle_start", player_id, monster_id})
  → index.js 路由 → battle.js handler
    → BattleSystem.executeBattle(player, monster_id)
      → Monster 字典查询 → 逐回合伤害计算
      → InventoryManager 处理掉落物
      → EventEmitter.logEvent("battle_victory/defeat")
      → TaskManager.checkTaskProgress("kill_monster", monster_id)
    → PlayerDataService.savePlayer()
  → WebSocket 推送: battle_round × N → battle_end
  → BattleScene 播放动画 → UIScene 更新 HUD
```

#### NPC 对话流程

```
玩家碰撞 NPC → GameScene 碰撞检测
  → WebSocketClient.send({type: "npc_dialogue_start", player_id, npc_id})
  → index.js 路由 → npc.js handler
    → callNPCAgentAgentCore(player_id, npc_id)
      → AgentCore SDK → NPC Agent (agent.py)
        → 并行查询 DynamoDB 6 张表（~200ms）
        → 构建 Prompt（玩家数据 + 字典 + 行为历史）
        → 单次 Bedrock API 调用（~3.5s）
        → task_validator 校验（7 项规则）
        → 写入 Tasks 表
      → 返回 {dialogue, task, debug_log}
    → EventEmitter.logEvent("talk_to_npc")
  → WebSocket 推送: npc_dialogue_response
  → UIScene 显示对话框 + 任务接取界面
```

#### 任务完成流程

```
玩家完成任务条件（击杀怪物/收集道具/使用道具）
  → TaskManager.checkTaskProgress() 自动检测
  → 所有条件满足 → TaskManager.completeTask()
    → 发放奖励（经验/金币/道具）
    → 检查升级 → 更新玩家数据
    → EventEmitter.logEvent("task_completed")
    → PlayerDataService.savePlayer()
  → WebSocket 推送: task_progress → task_completed
```

---

## 6. AI 任务生成系统

### 6.1 NPC 任务类型限制

| NPC | npc_id | 任务类型 | 说明 |
|-----|--------|---------|------|
| 村长老莫 | npc_elder | kill_monster | 只发打怪任务 |
| 铁匠格雷 | npc_blacksmith | collect_item | 只发材料收集任务 |
| 商人莉娜 | npc_merchant | use_item | 只发使用道具任务 |
| 药师艾琳 | npc_healer | use_item | 只发使用药水/恢复任务 |
| 斥候阿克 | npc_scout | kill_monster | 只发战斗探索任务 |

### 6.2 动态决策逻辑

- 新玩家（无事件）→ 村长：初级打怪任务
- 近期战斗胜利 → 斥候：更高等级打怪任务
- 近期战斗失败 → 铁匠：收集装备材料任务
- 低血量 + 有药水 → 药师：使用药水恢复任务
- 有未使用装备 → 商人：使用装备任务

### 6.3 任务校验规则（task_validator.py）

1. 结构完整性：title、description、conditions、awards 必须存在且非空
2. npc_id 校验：任务发布者必须在 NPC 字典表中存在
3. 条件类型合法：必须是 kill_monster / collect_item / talk_to_npc / use_item 之一
4. target_id 存在性：引用的怪物/道具/NPC ID 必须在对应字典表中存在
5. 奖励 item_id 存在性：道具奖励的 item_id 必须在 Items 表中存在
6. 数值范围：金币 1-1000，经验 1-500，道具数量 1-99，required_count 1-99
7. 任务去重：不能与玩家已有任务的 conditions 组合重复

---

## 7. 已知 Bug

| # | 描述 | 影响模块 |
|---|------|---------|
| 1 | 村长说"击杀3只"但任务条件是1只，对话与任务数量不一致 | NPC Agent / Prompt |
| 2 | NPC 对话触发距离过大，附近停留也会触发 | 前端 GameScene 碰撞检测 |
| 3 | 满血情况下药师仍发布补充药水任务 | NPC Agent 决策逻辑 |
| 4 | 靠近药师但对话标题显示村长 | 前端 NPC 标识 / npc.js |
| 5 | 对话内容中输出了大模型的推理内容（thinking 泄露） | NPC Agent JSON 解析 |
