# V3 代码摘要 - 多玩家可见性

## 修改文件

### 1. backend/game-server/src/index.js (Modified)
**变更**:
- 新增 `connectedPlayers` Map：跟踪所有在线玩家 (ws → player info)
- 新增 `broadcastToOthers()` / `broadcastToAll()` 广播函数
- 新增 `player_register` 消息处理：注册玩家 + 下发 `players_list` + 广播 `player_join`
- 修改 `player_move` 处理：更新注册表位置 + 广播 `player_moved` 给其他玩家
- 修改 `ws.on('close')` 处理：从注册表移除 + 广播 `player_leave`

### 2. frontend/src/entities/RemotePlayer.js (Created)
**新建**:
- `RemotePlayer` 类：继承 `Phaser.GameObjects.Sprite`
- 使用现有角色 spritesheet (player/player_2) 显示静态精灵图
- 名称标签 (Text) 跟随精灵位置
- `updatePosition(x, y)`: 100ms tween 平滑移动
- `destroy()`: 清理精灵和文字

### 3. frontend/src/scenes/GameScene.js (Modified)
**变更**:
- 导入 `RemotePlayer`
- 新增 `this.remotePlayers` Map 和 `this.lastPositionSendTime`
- WebSocket 连接后发送 `player_register` 注册多玩家
- `update()` 中每 100ms 发送本地玩家位置
- `setupWSHandlers()` 新增 4 个处理器:
  - `players_list`: 初始化已在线远程玩家
  - `player_join`: 创建新远程玩家
  - `player_leave`: 销毁离开的远程玩家
  - `player_moved`: 更新远程玩家位置

## 新增 WebSocket 协议

| 方向 | 消息类型 | 数据 |
|------|----------|------|
| C→S | `player_register` | `{player_id, x, y, character, name}` |
| S→C | `players_list` | `{players: [{player_id, x, y, character, name}]}` |
| S→C | `player_join` | `{player_id, x, y, character, name}` |
| S→C | `player_leave` | `{player_id}` |
| S→C | `player_moved` | `{player_id, x, y}` |
