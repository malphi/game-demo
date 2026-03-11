const playerDataService = require('../services/PlayerDataService');
const eventEmitter = require('../services/EventEmitter');

/**
 * NPC dialogue handler for WebSocket messages.
 *
 * Calls the NPC Agent deployed on AWS AgentCore Runtime.
 * The NPC Agent reads game data from DynamoDB, calls Bedrock LLM,
 * and returns dialogue + task based on player state.
 */

/**
 * Handle NPC dialogue start — calls NPC Agent via AgentCore.
 */
async function handleNPCDialogue(ws, message) {
  const { player_id, npc_id } = message;
  console.log(`[HANDLER] npc_dialogue_start: player=${player_id}, npc=${npc_id}`);

  if (!player_id || !npc_id) {
    ws.send(JSON.stringify({ type: 'error', message: 'player_id and npc_id are required' }));
    return;
  }

  // Auto-create player in DynamoDB if not found
  let player = await playerDataService.getPlayer(player_id);
  if (!player) {
    console.log(`[HANDLER] Player not found, auto-creating: ${player_id}`);
    player = await playerDataService.createPlayer(player_id, player_id);
  }

  // Call NPC Agent via AgentCore
  let dialogueResult;
  try {
    dialogueResult = await callNPCAgentAgentCore(player_id, npc_id);
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
    npc_name: dialogueResult.npc_name || npc_id,
  });

  // Send dialogue response
  const dialogueMsg = {
    type: 'npc_dialogue_response',
    npc_id: dialogueResult.npc_id || npc_id,
    npc_name: dialogueResult.npc_name || npc_id,
    dialogue: dialogueResult.dialogue,
    task: dialogueResult.task || null,
    debug_log: dialogueResult.debug_log || [],
  };
  console.log(`[WS:SEND] npc_dialogue_response: npc=${dialogueMsg.npc_name}, hasTask=${!!dialogueMsg.task}`);
  ws.send(JSON.stringify(dialogueMsg));
}

/**
 * Handle task acceptance — update DynamoDB task status.
 */
async function handleTaskAccept(ws, message) {
  const { player_id, task_id } = message;
  console.log(`[HANDLER] task_accept: player=${player_id}, task=${task_id}`);

  if (!player_id || !task_id) {
    ws.send(JSON.stringify({ type: 'error', message: 'player_id and task_id are required' }));
    return;
  }

  const player = await playerDataService.getPlayer(player_id);
  if (!player) {
    ws.send(JSON.stringify({ type: 'error', message: `Player not found: ${player_id}` }));
    return;
  }

  // Update task status in DynamoDB to "in_progress"
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
 * Call the NPC Agent via AgentCore Runtime.
 */
async function callNPCAgentAgentCore(playerId, npcId) {
  const { BedrockAgentCoreClient, InvokeAgentRuntimeCommand } = require('@aws-sdk/client-bedrock-agentcore');
  const client = new BedrockAgentCoreClient({
    region: process.env.AWS_REGION || 'us-west-2',
  });

  const payload = JSON.stringify({ player_id: playerId, npc_id: npcId });
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
