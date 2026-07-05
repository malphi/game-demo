const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');
const url = require('url');

// Handlers
const { handleGameStart, handleGameSave } = require('./handlers/session');
const { handleBattle } = require('./handlers/battle');
const { handleNPCDialogue, handleTaskAccept, handleTaskReject } = require('./handlers/npc');
const { handleGetTasks, handleCompleteTask, handleUseItem } = require('./handlers/task');

// Services
const playerDataService = require('./services/PlayerDataService');
const InventoryManager = require('./services/InventoryManager');
const eventEmitter = require('./services/EventEmitter');
const taskManager = require('./services/TaskManager');
const taskPreGenerator = require('./services/TaskPreGenerator');

// Models (loaded at startup to verify dictionary data)
const { getAllMonsters, getMonster } = require('./models/Monster');
const { getAllNPCs, getNPC } = require('./models/NPC');
const { getAllItems, getItem } = require('./models/Item');

/**
 * Handle task completion: update DynamoDB task status to "completed".
 */
async function handleTaskComplete(ws, message) {
  const { player_id, task_id } = message;
  console.log(`[HANDLER] task_complete: player=${player_id}, task=${task_id}`);
  if (!player_id || !task_id) return;

  if (process.env.USE_DYNAMODB === 'true') {
    try {
      const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
      const { DynamoDBDocumentClient, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
      const config = { region: process.env.AWS_REGION || 'us-west-2' };
      if (process.env.DYNAMODB_ENDPOINT) {
        config.endpoint = process.env.DYNAMODB_ENDPOINT;
      }
      const client = new DynamoDBClient(config);
      const docClient = DynamoDBDocumentClient.from(client);
      const env = process.env.ENV || '';
      const tasksTableName = env ? `Tasks-${env}` : 'Tasks';
      await docClient.send(new UpdateCommand({
        TableName: tasksTableName,
        Key: { task_id },
        UpdateExpression: 'SET #s = :s, #ca = :ca',
        ExpressionAttributeNames: { '#s': 'status', '#ca': 'completed_at' },
        ExpressionAttributeValues: { ':s': 'completed', ':ca': new Date().toISOString() },
      }));
      console.log(`[HANDLER] Updated task ${task_id} status to completed in DynamoDB`);
    } catch (err) {
      console.error(`[HANDLER] Failed to update task in DynamoDB: ${err.message}`);
    }
  }

  ws.send(JSON.stringify({ type: 'task_completed_ack', task_id }));

  // Trigger pre-generation now that the task is completed in DynamoDB
  taskPreGenerator.triggerPreGeneration(player_id, 'task_completed', {
    task_id,
  }, ws);
}

// ---- Express App Setup ----
const app = express();
app.use(express.json());

// CORS for local development
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// ---- REST API Routes ----

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    mode: process.env.USE_DYNAMODB === 'true' ? 'dynamodb' : 'in-memory',
    timestamp: new Date().toISOString(),
  });
});

// Game session
app.post('/api/game/start', handleGameStart);
app.post('/api/game/save', handleGameSave);

// Player
app.post('/api/player/create', async (req, res) => {
  try {
    const { name } = req.body || {};
    const player = await playerDataService.createPlayer(name);
    res.json({ success: true, player });
  } catch (err) {
    console.error('Error creating player:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/player/:id', async (req, res) => {
  try {
    const player = await playerDataService.getPlayer(req.params.id);
    if (!player) {
      return res.status(404).json({ success: false, message: 'Player not found' });
    }
    res.json({ success: true, player });
  } catch (err) {
    console.error('Error getting player:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/player/:id/inventory', async (req, res) => {
  try {
    const player = await playerDataService.getPlayer(req.params.id);
    if (!player) {
      return res.status(404).json({ success: false, message: 'Player not found' });
    }
    res.json({ success: true, inventory: player.inventory });
  } catch (err) {
    console.error('Error getting inventory:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Tasks
app.get('/api/tasks/:playerId', handleGetTasks);
app.post('/api/tasks/:taskId/complete', handleCompleteTask);

// Reset game data for a specific player
app.post('/api/game/reset', async (req, res) => {
  try {
    const { player_id } = req.body || {};
    if (!player_id) {
      return res.status(400).json({ success: false, message: 'player_id is required' });
    }

    console.log(`[RESET] Resetting data for player: ${player_id}`);

    // Clear in-memory data for this player
    playerDataService.players.delete(player_id);
    taskManager.clearPlayer && taskManager.clearPlayer(player_id);
    eventEmitter.clearPlayer && eventEmitter.clearPlayer(player_id);
    taskPreGenerator.clearPlayer(player_id);

    // Clear DynamoDB data for this player
    const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
    const { DynamoDBDocumentClient, DeleteCommand, QueryCommand, ScanCommand, BatchWriteItemCommand } = require('@aws-sdk/lib-dynamodb');
    const config = { region: process.env.AWS_REGION || 'us-west-2' };
    if (process.env.DYNAMODB_ENDPOINT) {
      config.endpoint = process.env.DYNAMODB_ENDPOINT;
    }
    const docClient = DynamoDBDocumentClient.from(new DynamoDBClient(config));

    const env = process.env.ENV || 'dev';
    let totalDeleted = 0;

    // 1. Delete player record
    try {
      await docClient.send(new DeleteCommand({
        TableName: `Players-${env}`,
        Key: { player_id },
      }));
      totalDeleted++;
      console.log(`[RESET] Deleted player ${player_id} from Players-${env}`);
    } catch (err) {
      console.warn(`[RESET] Failed to delete player: ${err.message}`);
    }

    // 2. Delete player's tasks (query by player_id-index)
    try {
      const tasksResp = await docClient.send(new QueryCommand({
        TableName: `Tasks-${env}`,
        IndexName: 'player_id-index',
        KeyConditionExpression: 'player_id = :pid',
        ExpressionAttributeValues: { ':pid': player_id },
      }));
      const tasks = tasksResp.Items || [];
      for (const task of tasks) {
        await docClient.send(new DeleteCommand({
          TableName: `Tasks-${env}`,
          Key: { task_id: task.task_id },
        }));
      }
      totalDeleted += tasks.length;
      console.log(`[RESET] Deleted ${tasks.length} tasks for player ${player_id}`);
    } catch (err) {
      console.warn(`[RESET] Failed to delete tasks: ${err.message}`);
    }

    // 3. Delete player's events (query by player_id partition key)
    try {
      const eventsResp = await docClient.send(new QueryCommand({
        TableName: `PlayerEventSummary-${env}`,
        KeyConditionExpression: 'player_id = :pid',
        ExpressionAttributeValues: { ':pid': player_id },
      }));
      const events = eventsResp.Items || [];
      for (const event of events) {
        await docClient.send(new DeleteCommand({
          TableName: `PlayerEventSummary-${env}`,
          Key: { player_id: event.player_id, event_id: event.event_id },
        }));
      }
      totalDeleted += events.length;
      console.log(`[RESET] Deleted ${events.length} events for player ${player_id}`);
    } catch (err) {
      console.warn(`[RESET] Failed to delete events: ${err.message}`);
    }

    res.json({ success: true, message: `Deleted ${totalDeleted} items for player ${player_id}.` });
  } catch (err) {
    console.error('Error resetting player data:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Dictionary endpoints (read-only references)
app.get('/api/dict/monsters', (req, res) => {
  res.json({ success: true, monsters: getAllMonsters() });
});

app.get('/api/dict/npcs', (req, res) => {
  res.json({ success: true, npcs: getAllNPCs() });
});

app.get('/api/dict/items', (req, res) => {
  res.json({ success: true, items: getAllItems() });
});

// ---- Serve frontend static files ----
const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir));
// SPA fallback: non-API routes serve index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// ---- HTTP Server ----
const PORT = process.env.PORT || 8080;
const server = http.createServer(app);

// ---- WebSocket Server ----
const wss = new WebSocketServer({
  server,
  path: '/ws',
});

// Connected players registry: ws -> { player_id, x, y, character, name }
const connectedPlayers = new Map();

function broadcastToOthers(senderWs, message) {
  const msg = JSON.stringify(message);
  for (const [ws] of connectedPlayers) {
    if (ws !== senderWs && ws.readyState === 1) {
      ws.send(msg);
    }
  }
}

function broadcastToAll(message) {
  const msg = JSON.stringify(message);
  for (const [ws] of connectedPlayers) {
    if (ws.readyState === 1) {
      ws.send(msg);
    }
  }
}

wss.on('connection', (ws, req) => {
  console.log('WebSocket client connected');

  ws.on('message', async (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch (err) {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
      return;
    }

    console.log(`[WS:RECV] type=${message.type}`, JSON.stringify(message));

    try {
      switch (message.type) {
        case 'battle_start':
          await handleBattle(ws, message);
          break;

        case 'npc_dialogue_start':
          await handleNPCDialogue(ws, message);
          break;

        case 'task_accept':
          await handleTaskAccept(ws, message);
          break;

        case 'task_reject':
          await handleTaskReject(ws, message);
          break;

        case 'use_item':
          await handleUseItem(ws, message);
          break;

        case 'task_complete':
          await handleTaskComplete(ws, message);
          break;

        case 'player_move':
          // Update player position and broadcast to others
          if (message.player_id) {
            await playerDataService.updatePlayer(message.player_id, {
              position_x: message.x,
              position_y: message.y,
            });
            // Update connectedPlayers registry
            const pInfo = connectedPlayers.get(ws);
            if (pInfo) {
              pInfo.x = message.x;
              pInfo.y = message.y;
            }
            // Broadcast position to other players
            broadcastToOthers(ws, {
              type: 'player_moved',
              player_id: message.player_id,
              x: message.x,
              y: message.y,
            });
          }
          break;

        case 'player_register': {
          const { player_id, x, y, character, name } = message;
          if (!player_id) break;
          const playerInfo = { player_id, x: x || 400, y: y || 300, character: character || 'player', name: name || player_id };
          connectedPlayers.set(ws, playerInfo);
          console.log(`[MP] Player registered: ${player_id} (${connectedPlayers.size} online)`);
          // Send current online players list to the new player
          const playersList = [];
          for (const [otherWs, info] of connectedPlayers) {
            if (otherWs !== ws) {
              playersList.push(info);
            }
          }
          ws.send(JSON.stringify({ type: 'players_list', players: playersList }));
          // Broadcast new player to others
          broadcastToOthers(ws, { type: 'player_join', ...playerInfo });
          // Trigger pre-generation on login (now we have ws for console notifications)
          taskPreGenerator.triggerPreGeneration(player_id, 'player_login', {
            is_new: true,
          }, ws);
          break;
        }

        case 'ping':
          ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
          break;

        default:
          ws.send(
            JSON.stringify({
              type: 'error',
              message: `Unknown message type: ${message.type}`,
            })
          );
      }
    } catch (err) {
      console.error(`Error handling message type "${message.type}":`, err);
      ws.send(
        JSON.stringify({
          type: 'error',
          message: `Server error handling ${message.type}: ${err.message}`,
        })
      );
    }
  });

  ws.on('close', () => {
    const playerInfo = connectedPlayers.get(ws);
    if (playerInfo) {
      connectedPlayers.delete(ws);
      console.log(`[MP] Player disconnected: ${playerInfo.player_id} (${connectedPlayers.size} online)`);
      broadcastToAll({ type: 'player_leave', player_id: playerInfo.player_id });
    } else {
      console.log('WebSocket client disconnected');
    }
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
  });

  // Send welcome message
  ws.send(
    JSON.stringify({
      type: 'connected',
      message: 'Connected to game server',
      timestamp: Date.now(),
    })
  );
});

// ---- Start Server ----
server.listen(PORT, () => {
  const mode = process.env.USE_DYNAMODB === 'true' ? 'DynamoDB' : 'In-Memory';
  console.log(`\n========================================`);
  console.log(`  Game Server started`);
  console.log(`  Port: ${PORT}`);
  console.log(`  Mode: ${mode}`);
  console.log(`  REST API: http://localhost:${PORT}/api`);
  console.log(`  WebSocket: ws://localhost:${PORT}/ws`);
  console.log(`========================================\n`);

  // Log loaded dictionary data
  console.log('Dictionary data loaded:');
  console.log(`  Monsters: ${getAllMonsters().length}`);
  console.log(`  NPCs:     ${getAllNPCs().length}`);
  console.log(`  Items:    ${getAllItems().length}`);
  console.log('');
});

module.exports = { app, server, wss };
