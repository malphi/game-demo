const playerDataService = require('../services/PlayerDataService');
const eventEmitter = require('../services/EventEmitter');
const taskPreGenerator = require('../services/TaskPreGenerator');
const { getNPC } = require('../models/NPC');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');

const ddbConfig = { region: process.env.AWS_REGION || 'us-west-2' };
if (process.env.DYNAMODB_ENDPOINT) {
  ddbConfig.endpoint = process.env.DYNAMODB_ENDPOINT;
}
const docClient = DynamoDBDocumentClient.from(new DynamoDBClient(ddbConfig));
const env = process.env.ENV || '';
const tasksTableName = env ? `Tasks-${env}` : 'Tasks';

/**
 * NPC dialogue handler for WebSocket messages.
 *
 * First checks DynamoDB for existing tasks from this NPC.
 * Only calls AgentCore (LLM) when no active task exists.
 */

/**
 * Query tasks for a player from a specific NPC.
 */
async function getPlayerTasksFromNPC(playerId, npcId) {
  const resp = await docClient.send(new QueryCommand({
    TableName: tasksTableName,
    IndexName: 'player_id-index',
    KeyConditionExpression: 'player_id = :pid',
    ExpressionAttributeValues: { ':pid': playerId },
  }));
  return (resp.Items || []).filter(t => t.npc_id === npcId);
}

/**
 * Handle NPC dialogue start.
 * Checks for existing tasks first; only calls AgentCore if none found.
 */
async function handleNPCDialogue(ws, message) {
  const { player_id, npc_id } = message;
  console.log(`[HANDLER] npc_dialogue_start: player=${player_id}, npc=${npc_id}`);

  if (!player_id || !npc_id) {
    ws.send(JSON.stringify({ type: 'error', message: 'player_id and npc_id are required' }));
    return;
  }

  const npc = getNPC(npc_id);
  if (!npc) {
    ws.send(JSON.stringify({ type: 'error', message: `NPC not found: ${npc_id}` }));
    return;
  }

  // Auto-create player in DynamoDB if not found
  let player = await playerDataService.getPlayer(player_id);
  if (!player) {
    console.log(`[HANDLER] Player not found, auto-creating: ${player_id}`);
    player = await playerDataService.createPlayer(player_id, player_id);
  }

  // Check existing in_progress tasks — skip AgentCore if found
  try {
    const npcTasks = await getPlayerTasksFromNPC(player_id, npc_id);
    for (const task of npcTasks) {
      if (task.status === 'in_progress') {
        console.log(`[HANDLER] Player has in_progress task '${task.title}' from ${npc_id}, skipping AgentCore`);
        ws.send(JSON.stringify({
          type: 'npc_dialogue_response',
          npc_id,
          npc_name: npc.name,
          dialogue: `你还没完成我交给你的任务「${task.title}」呢！${task.description}，快去吧！`,
          task: null,
          debug_log: [],
        }));
        return;
      }
    }
  } catch (err) {
    console.warn(`[HANDLER] Failed to check existing tasks: ${err.message}`);
  }

  // Check pre-generated cache first (instant delivery!)
  // This is checked BEFORE pending tasks because pre-generation creates tasks as
  // "pending" in DynamoDB, and the pre-generated dialogue describes the task naturally.
  let preGenResult = taskPreGenerator.consumePreGenerated(player_id, npc_id);

  // If not cached but a generation is in-flight, wait for it (still faster than cold call)
  if (!preGenResult) {
    const pendingPromise = taskPreGenerator.getPendingPromise(player_id, npc_id);
    if (pendingPromise) {
      console.log(`[HANDLER] Waiting for in-flight pre-generation for player=${player_id}`);
      await pendingPromise;
      preGenResult = taskPreGenerator.consumePreGenerated(player_id, npc_id);
    }
  }

  if (preGenResult) {
    // Serve pre-generated result instantly
    console.log(`[HANDLER] Serving pre-generated dialogue for player=${player_id}, npc=${npc_id}`);

    // Send greeting based on the event that triggered pre-generation
    const greetingResult = await callNPCAgentGreeting(player_id, npc_id).catch(err => {
      console.warn('[HANDLER] Greeting call failed, skipping:', err.message);
      return null;
    });
    if (greetingResult && greetingResult.greeting) {
      ws.send(JSON.stringify({
        type: 'npc_dialogue_greeting',
        npc_id,
        npc_name: greetingResult.npc_name || npc.name,
        greeting: greetingResult.greeting,
      }));
    }

    eventEmitter.logEvent(player_id, 'talk_to_npc', npc_id, 'success', { npc_name: npc.name });

    const dialogueMsg = {
      type: 'npc_dialogue_response',
      npc_id: preGenResult.npc_id || npc_id,
      npc_name: preGenResult.npc_name || npc.name,
      dialogue: preGenResult.dialogue,
      task: preGenResult.task || null,
      debug_log: [
        { type: 'pre_generated', event_type: preGenResult.event_type, ms: 0 },
        ...(preGenResult.debug_log || []),
      ],
    };
    console.log(`[WS:SEND] npc_dialogue_response (pre-generated): npc=${dialogueMsg.npc_name}, hasTask=${!!dialogueMsg.task}`);
    ws.send(JSON.stringify(dialogueMsg));
    return;
  }

  // Check for pending tasks (created by pre-gen but cache expired/missed)
  try {
    const npcTasks = await getPlayerTasksFromNPC(player_id, npc_id);
    const pendingTask = npcTasks.find(t => t.status === 'pending');
    if (pendingTask) {
      console.log(`[HANDLER] Player has pending task '${pendingTask.title}' from ${npc_id}, serving directly`);
      ws.send(JSON.stringify({
        type: 'npc_dialogue_response',
        npc_id,
        npc_name: npc.name,
        dialogue: pendingTask.description || `我这里有个任务给你：「${pendingTask.title}」`,
        task: pendingTask,
        debug_log: [],
      }));
      return;
    }
  } catch (err) {
    console.warn(`[HANDLER] Failed to check pending tasks: ${err.message}`);
  }

  // Fallback: no pre-generated result — call greeting + dialogue in parallel
  console.log(`[HANDLER] No pre-generated result, calling AgentCore directly for player=${player_id}`);
  const greetingPromise = callNPCAgentGreeting(player_id, npc_id).catch(err => {
    console.warn('[HANDLER] Greeting call failed, skipping:', err.message);
    return null;
  });
  const dialoguePromise = callNPCAgentAgentCore(player_id, npc_id);

  // Send greeting as soon as it's ready (masks LLM latency)
  const greetingResult = await greetingPromise;
  if (greetingResult && greetingResult.greeting) {
    ws.send(JSON.stringify({
      type: 'npc_dialogue_greeting',
      npc_id,
      npc_name: greetingResult.npc_name || npc.name,
      greeting: greetingResult.greeting,
    }));
    console.log(`[WS:SEND] npc_dialogue_greeting: npc=${greetingResult.npc_name || npc.name}`);
  }

  // Wait for full dialogue result
  let dialogueResult;
  try {
    dialogueResult = await dialoguePromise;
  } catch (err) {
    console.error('[HANDLER] NPC Agent call failed:', err.message);
    ws.send(JSON.stringify({
      type: 'error',
      message: `NPC Agent error: ${err.message}`,
    }));
    return;
  }

  // Log the NPC dialogue event
  eventEmitter.logEvent(player_id, 'talk_to_npc', npc_id, 'success', {
    npc_name: npc.name,
  });

  // Send dialogue response
  const dialogueMsg = {
    type: 'npc_dialogue_response',
    npc_id: dialogueResult.npc_id || npc_id,
    npc_name: dialogueResult.npc_name || npc.name,
    dialogue: dialogueResult.dialogue,
    task: dialogueResult.task || null,
    debug_log: dialogueResult.debug_log || [],
  };
  console.log(`[WS:SEND] npc_dialogue_response: npc=${dialogueMsg.npc_name}, hasTask=${!!dialogueMsg.task}`);
  ws.send(JSON.stringify(dialogueMsg));
}

/**
 * Handle task acceptance — update DynamoDB task status.
 * Enforces: one active task per NPC per player.
 */
async function handleTaskAccept(ws, message) {
  const { player_id, task_id, npc_id } = message;
  console.log(`[HANDLER] task_accept: player=${player_id}, task=${task_id}, npc=${npc_id}`);

  if (!player_id || !task_id) {
    ws.send(JSON.stringify({ type: 'error', message: 'player_id and task_id are required' }));
    return;
  }

  const player = await playerDataService.getPlayer(player_id);
  if (!player) {
    ws.send(JSON.stringify({ type: 'error', message: `Player not found: ${player_id}` }));
    return;
  }

  // Check: only one active task per NPC
  if (npc_id) {
    try {
      const npcTasks = await getPlayerTasksFromNPC(player_id, npc_id);
      const existing = npcTasks.find(t => t.status === 'in_progress');
      if (existing) {
        console.log(`[HANDLER] Player already has in_progress task from ${npc_id}, rejecting accept`);
        ws.send(JSON.stringify({ type: 'error', message: '你已经有这个NPC的进行中任务了' }));
        return;
      }
    } catch (err) {
      console.warn(`[HANDLER] Failed to check NPC task constraint: ${err.message}`);
    }
  }

  // Update task status in DynamoDB to "in_progress"
  try {
    const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');
    await docClient.send(new UpdateCommand({
      TableName: tasksTableName,
      Key: { task_id },
      UpdateExpression: 'SET #s = :s',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':s': 'in_progress' },
    }));
    console.log(`[HANDLER] Updated task ${task_id} status to in_progress in DynamoDB`);
  } catch (err) {
    console.error(`[HANDLER] Failed to update task in DynamoDB: ${err.message}`);
  }

  // Add task to player's active tasks
  if (!player.active_tasks) player.active_tasks = [];
  if (!player.active_tasks.includes(task_id)) {
    player.active_tasks.push(task_id);
  }

  eventEmitter.logEvent(player_id, 'task_accepted', task_id, 'success', { task_id });
  await playerDataService.savePlayer(player);

  ws.send(JSON.stringify({ type: 'task_accepted', task_id }));
}

/**
 * Handle task rejection.
 */
async function handleTaskReject(ws, message) {
  const { player_id, task_id } = message;
  console.log(`[HANDLER] task_reject: player=${player_id}, task=${task_id}`);

  eventEmitter.logEvent(player_id, 'task_rejected', task_id, 'success', { task_id });
  ws.send(JSON.stringify({ type: 'task_rejected', task_id, message: 'Task declined' }));
}

/**
 * Call the NPC Agent greeting via AgentCore Runtime (fast, ~100ms).
 */
async function callNPCAgentGreeting(playerId, npcId) {
  return callNPCAgentAgentCore(playerId, npcId, 'greeting');
}

/**
 * Call the NPC Agent via AgentCore Runtime.
 * @param {string} action - "dialogue" (default) or "greeting"
 */
async function callNPCAgentAgentCore(playerId, npcId, action = 'dialogue') {
  const { BedrockAgentCoreClient, InvokeAgentRuntimeCommand } = require('@aws-sdk/client-bedrock-agentcore');
  const client = new BedrockAgentCoreClient({
    region: process.env.AWS_REGION || 'us-west-2',
  });

  const payload = JSON.stringify({ player_id: playerId, npc_id: npcId, action });
  const input = {
    agentRuntimeArn: process.env.AGENTCORE_RUNTIME_ARN,
    contentType: 'application/json',
    accept: 'application/json',
    payload: Buffer.from(payload),
  };
  if (process.env.AGENTCORE_ENDPOINT_NAME) {
    input.qualifier = process.env.AGENTCORE_ENDPOINT_NAME;
  }
  const command = new InvokeAgentRuntimeCommand(input);

  console.log('[AgentCore] Invoking NPC Agent...');
  const response = await client.send(command);
  console.log('[AgentCore] Response statusCode:', response.statusCode);

  // Read the streaming response body
  const chunks = [];
  if (response.response && typeof response.response[Symbol.asyncIterator] === 'function') {
    for await (const chunk of response.response) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
  } else if (Buffer.isBuffer(response.response)) {
    chunks.push(response.response);
  } else if (typeof response.response === 'string') {
    chunks.push(Buffer.from(response.response));
  }

  const body = chunks.length > 0 ? Buffer.concat(chunks).toString('utf-8') : '';
  console.log('[AgentCore] Response body length:', body.length);

  if (!body) {
    throw new Error('Empty response from AgentCore');
  }

  // AgentCore may double-encode JSON (agent returns json.dumps, transport wraps again)
  let result = JSON.parse(body);
  if (typeof result === 'string') {
    result = JSON.parse(result);
  }
  console.log('[AgentCore] Parsed response keys:', Object.keys(result));
  return result;
}

module.exports = {
  handleNPCDialogue,
  handleTaskAccept,
  handleTaskReject,
};
