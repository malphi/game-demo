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

// Reset game data (clear in-memory + DynamoDB player-related tables)
app.post('/api/game/reset', async (req, res) => {
  try {
    // Always clear in-memory store
    playerDataService.players.clear();
    taskManager.clearAll && taskManager.clearAll();
    eventEmitter.clearAll && eventEmitter.clearAll();

    // Always clear DynamoDB tables (NPC Agent reads tasks from DynamoDB directly)
    const { DynamoDBClient, ScanCommand, BatchWriteItemCommand } = require('@aws-sdk/client-dynamodb');
    const config = { region: process.env.AWS_REGION || 'us-west-2' };
    if (process.env.DYNAMODB_ENDPOINT) {
      config.endpoint = process.env.DYNAMODB_ENDPOINT;
    }
    const ddbClient = new DynamoDBClient(config);

    const env = process.env.ENV || 'dev';
    const tables = [
      { name: `Players-${env}`, keyAttrs: ['player_id'] },
      { name: `Tasks-${env}`, keyAttrs: ['task_id'] },
      { name: `PlayerEventSummary-${env}`, keyAttrs: ['player_id', 'event_id'] },
    ];

    let totalDeleted = 0;
    for (const table of tables) {
      try {
        // Scan all items
        let items = [];
        let lastKey = undefined;
        do {
          const scanResp = await ddbClient.send(new ScanCommand({
            TableName: table.name,
            ProjectionExpression: table.keyAttrs.join(', '),
            ExclusiveStartKey: lastKey,
          }));
          items.push(...(scanResp.Items || []));
          lastKey = scanResp.LastEvaluatedKey;
        } while (lastKey);

        // Batch delete in chunks of 25
        for (let i = 0; i < items.length; i += 25) {
          const batch = items.slice(i, i + 25);
          const deleteRequests = batch.map((item) => {
            const key = {};
            for (const attr of table.keyAttrs) {
              key[attr] = item[attr];
            }
            return { DeleteRequest: { Key: key } };
          });
          await ddbClient.send(new BatchWriteItemCommand({
            RequestItems: { [table.name]: deleteRequests },
          }));
        }
        totalDeleted += items.length;
        console.log(`[RESET] Cleared ${items.length} items from ${table.name}`);
      } catch (tableErr) {
        console.warn(`[RESET] Failed to clear ${table.name}: ${tableErr.message}`);
      }
    }

    res.json({ success: true, message: `Reset complete. Deleted ${totalDeleted} items from DynamoDB.` });
  } catch (err) {
    console.error('Error resetting game data:', err);
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
          // Update player position
          if (message.player_id) {
            await playerDataService.updatePlayer(message.player_id, {
              position_x: message.x,
              position_y: message.y,
            });
            ws.send(
              JSON.stringify({
                type: 'player_move_ack',
                x: message.x,
                y: message.y,
              })
            );
          }
          break;

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
    console.log('WebSocket client disconnected');
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
