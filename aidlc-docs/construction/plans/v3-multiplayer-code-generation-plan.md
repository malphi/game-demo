# V3 代码生成计划 - 多玩家可见性

## 上下文
- **项目类型**: Brownfield
- **工作单元**: 单一单元 (多玩家可见性)
- **涉及组件**: Game Server (index.js) + Frontend (GameScene.js, 新建 RemotePlayer.js)
- **不涉及**: NPC Agent, Infrastructure, DynamoDB schema

## 代码生成步骤

### Step 1: Game Server - 连接注册表与广播机制
**文件**: `backend/game-server/src/index.js`
**修改内容**:
- [x] 在 WebSocket server 初始化后添加 `connectedPlayers` Map (ws → {player_id, x, y, character, name})
- [x] 添加 `broadcastToOthers(senderWs, message)` 广播函数
- [x] 添加 `broadcastToAll(message)` 全量广播函数

### Step 2: Game Server - 玩家注册与列表下发
**文件**: `backend/game-server/src/index.js`
**修改内容**:
- [x] 新增 `player_register` 消息处理：玩家进入游戏场景后注册到 connectedPlayers
- [x] 注册时向新玩家发送 `players_list`（当前所有在线玩家）
- [x] 注册时向其他玩家广播 `player_join`（新玩家信息）

### Step 3: Game Server - 移动广播与断开清理
**文件**: `backend/game-server/src/index.js`
**修改内容**:
- [x] 修改 `player_move` 处理：更新 connectedPlayers 中的位置，向其他玩家广播 `player_moved`
- [x] 在 WebSocket `close` 事件中：从 connectedPlayers 移除，向其他玩家广播 `player_leave`

### Step 4: Frontend - RemotePlayer 类
**文件**: `frontend/src/entities/RemotePlayer.js`（新建）
**创建内容**:
- [x] 创建 RemotePlayer 类，接收 scene, player_id, x, y, character, name
- [x] 使用现有角色 spritesheet 创建静态精灵图
- [x] 显示玩家名称标签（Text 对象，跟随精灵位置）
- [x] `updatePosition(x, y)` 方法：平滑移动到目标位置（tween）
- [x] `destroy()` 方法：清理精灵和文字

### Step 5: Frontend - GameScene 多玩家集成
**文件**: `frontend/src/scenes/GameScene.js`
**修改内容**:
- [x] 添加 `this.remotePlayers = new Map()` (player_id → RemotePlayer)
- [x] 在 WebSocket 连接成功后发送 `player_register` 消息（包含 player_id, position, character, name）
- [x] 在 `setupWSHandlers()` 中添加 4 个新消息处理器：
  - `players_list`: 创建所有已在线玩家的 RemotePlayer
  - `player_join`: 创建新加入玩家的 RemotePlayer
  - `player_leave`: 销毁离开玩家的 RemotePlayer
  - `player_moved`: 更新远程玩家位置
- [x] 在 `update()` 中发送本地玩家位置（节流，每 100ms 一次）

### Step 6: 部署与测试
- [x] 构建前端 (`npm run build`)
- [x] 部署到 EC2 (`deploy.sh --gameserver-only`)
- [ ] 打开两个浏览器窗口验证多玩家可见性

### Step 7: 代码摘要文档
- [x] 创建 `aidlc-docs/construction/v3-multiplayer/code/code-summary.md`
