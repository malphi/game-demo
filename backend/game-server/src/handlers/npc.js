const { v4: uuidv4 } = require('uuid');
const { getNPC } = require('../models/NPC');
const { getAllMonsters } = require('../models/Monster');
const playerDataService = require('../services/PlayerDataService');
const taskManager = require('../services/TaskManager');
const eventEmitter = require('../services/EventEmitter');

/**
 * NPC dialogue handler for WebSocket messages.
 *
 * Handles:
 *   { type: "npc_dialogue_start", player_id, npc_id }
 *   { type: "task_accept", player_id, task_id }
 *   { type: "task_reject", player_id, task_id }
 *
 * In offline mode, uses a rule-based task generator to mimic NPC Agent behavior.
 * In online mode (NPC_AGENT_URL set), calls the NPC Agent API.
 */

/**
 * Handle NPC dialogue start.
 */
async function handleNPCDialogue(ws, message) {
  const { player_id, npc_id } = message;
  console.log(`[HANDLER] npc_dialogue_start: player=${player_id}, npc=${npc_id}`);

  if (!player_id || !npc_id) {
    ws.send(
      JSON.stringify({
        type: 'error',
        message: 'player_id and npc_id are required',
      })
    );
    return;
  }

  // Validate NPC exists
  const npc = getNPC(npc_id);
  if (!npc) {
    ws.send(
      JSON.stringify({
        type: 'error',
        message: `NPC not found: ${npc_id}`,
      })
    );
    return;
  }

  // Get player data
  const player = await playerDataService.getPlayer(player_id);
  if (!player) {
    ws.send(
      JSON.stringify({
        type: 'error',
        message: `Player not found: ${player_id}`,
      })
    );
    return;
  }

  let dialogueResult;

  // Check if online mode (AgentCore endpoint or NPC Agent HTTP API available)
  if (process.env.AGENTCORE_ENDPOINT_ARN || process.env.NPC_AGENT_URL) {
    try {
      dialogueResult = await callNPCAgentAPI(player_id, npc_id);
    } catch (err) {
      console.error('NPC Agent API call failed, falling back to offline mode:', err.message);
      dialogueResult = generateOfflineDialogue(player, npc);
    }
  } else {
    // Offline mode: rule-based task generation
    dialogueResult = generateOfflineDialogue(player, npc);
  }

  // Log the NPC dialogue event
  eventEmitter.logEvent(player_id, 'talk_to_npc', npc_id, 'success', {
    npc_name: npc.name,
  });

  // Check talk_to_npc task progress
  const taskUpdates = taskManager.checkTaskProgress(player, 'talk_to_npc', npc_id);
  if (taskUpdates.length > 0) {
    // Auto-complete tasks if conditions are met
    for (const update of taskUpdates) {
      if (update.taskComplete) {
        const completeResult = taskManager.completeTask(player, update.taskId);
        if (completeResult.success) {
          ws.send(
            JSON.stringify({
              type: 'task_completed',
              task_id: update.taskId,
              title: update.title,
              rewards: completeResult.rewards,
            })
          );
        }
      }
    }
    await playerDataService.savePlayer(player);
  }

  // Send dialogue response
  const dialogueMsg = {
    type: 'npc_dialogue_response',
    npc_id: npc_id,
    npc_name: npc.name,
    dialogue: dialogueResult.dialogue,
    task: dialogueResult.task || null,
    debug_log: dialogueResult.debug_log || [],
  };
  console.log(`[WS:SEND] npc_dialogue_response: npc=${npc.name}, hasTask=${!!dialogueResult.task}`, JSON.stringify(dialogueMsg));
  ws.send(JSON.stringify(dialogueMsg));
}

/**
 * Handle task acceptance.
 */
async function handleTaskAccept(ws, message) {
  const { player_id, task_id } = message;
  console.log(`[HANDLER] task_accept: player=${player_id}, task=${task_id}`);

  if (!player_id || !task_id) {
    ws.send(
      JSON.stringify({
        type: 'error',
        message: 'player_id and task_id are required',
      })
    );
    return;
  }

  const player = await playerDataService.getPlayer(player_id);
  if (!player) {
    ws.send(
      JSON.stringify({
        type: 'error',
        message: `Player not found: ${player_id}`,
      })
    );
    return;
  }

  // Update task status in DynamoDB to "in_progress"
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
        UpdateExpression: 'SET #s = :s',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':s': 'in_progress' },
      }));
      console.log(`[HANDLER] Updated task ${task_id} status to in_progress in DynamoDB`);
    } catch (err) {
      console.error(`[HANDLER] Failed to update task in DynamoDB: ${err.message}`);
    }
  }

  // Also update in-memory task if it exists
  const task = taskManager.getTask(task_id);
  if (task) {
    task.status = 'in_progress';
  }

  // Add task to player's active tasks
  if (!player.active_tasks) player.active_tasks = [];
  if (!player.active_tasks.includes(task_id)) {
    player.active_tasks.push(task_id);
  }

  // Log event
  eventEmitter.logEvent(player_id, 'task_accepted', task_id, 'success', {
    task_id,
  });

  await playerDataService.savePlayer(player);

  ws.send(
    JSON.stringify({
      type: 'task_accepted',
      task_id: task_id,
    })
  );
}

/**
 * Handle task rejection.
 */
async function handleTaskReject(ws, message) {
  const { player_id, task_id } = message;
  console.log(`[HANDLER] task_reject: player=${player_id}, task=${task_id}`);

  // Log event
  eventEmitter.logEvent(player_id, 'task_rejected', task_id, 'success', {
    task_id,
  });

  ws.send(
    JSON.stringify({
      type: 'task_rejected',
      task_id: task_id,
      message: 'Task declined',
    })
  );
}

/**
 * Rule-based offline dialogue and task generator.
 * Mimics what the AI NPC Agent would produce.
 */
function generateOfflineDialogue(player, npc) {
  const events = eventEmitter.getRecentEvents(player.player_id, 20);
  const { active } = taskManager.getPlayerTasks(player.player_id);

  // Analyze player state
  const recentVictories = events.filter((e) => e.event_type === 'battle_victory');
  const recentDefeats = events.filter((e) => e.event_type === 'battle_defeat');
  const isNewPlayer = events.length === 0;
  const hasLowHp = player.hp < player.max_hp * 0.5;

  // Get sorted monsters by level
  const allMonsters = getAllMonsters().sort((a, b) => a.level - b.level);

  let dialogue;
  let taskData;

  // Determine the highest monster level the player has beaten
  let maxDefeatedLevel = 0;
  for (const v of recentVictories) {
    const monsterId = v.details?.monster_id || v.target_id;
    const monster = allMonsters.find((m) => m.monster_id === monsterId);
    if (monster && monster.level > maxDefeatedLevel) {
      maxDefeatedLevel = monster.level;
    }
  }

  // ---- Decision logic based on player state ----

  if (isNewPlayer) {
    // New player: kill 3 slimes (scenario 3 from design doc)
    dialogue = getNewPlayerDialogue(npc);
    taskData = {
      player_id: player.player_id,
      npc_id: npc.npc_id,
      title: '初出茅庐',
      description: '年轻人，千里之行始于足下。村子东边的草地上有史莱姆，去消灭 1 只练练手吧。回来我有奖励给你。',
      conditions: [
        { type: 'kill_monster', target_id: 'slime_01', required_count: 1 },
      ],
      awards: [
        { type: 'exp', value: 20 },
        { type: 'gold', value: 10 },
        { type: 'item', item_id: 'hp_potion_s', quantity: 3 },
      ],
    };
  } else if (recentDefeats.length > 0 && recentDefeats.length >= recentVictories.length) {
    // Recent defeats dominate: help player get stronger
    if (hasLowHp && hasConsumableInInventory(player, 'hp_potion_s')) {
      // Scenario 4: guide to use potions
      dialogue = getDefeatHealDialogue(npc);
      taskData = {
        player_id: player.player_id,
        npc_id: npc.npc_id,
        title: '先恢复再出发',
        description: '你的气色看起来很差呢……背包里不是有药水吗？先喝一瓶恢复一下体力吧，受伤硬撑可不行哦。',
        conditions: [
          { type: 'use_item', target_id: 'hp_potion_s', required_count: 1 },
        ],
        awards: [{ type: 'exp', value: 10 }],
      };
    } else {
      // Scenario 2: kill slimes to get equipment drops
      dialogue = getDefeatEquipDialogue(npc);
      taskData = {
        player_id: player.player_id,
        npc_id: npc.npc_id,
        title: '消灭史莱姆获取装备',
        description: '先去消灭几只史莱姆吧，它们身上会掉落皮甲，能大幅提升你的防御力！',
        conditions: [
          { type: 'kill_monster', target_id: 'slime_01', required_count: 1 },
        ],
        awards: [
          { type: 'exp', value: 20 },
          { type: 'gold', value: 15 },
        ],
      };
    }
  } else if (recentVictories.length > 0) {
    // Recent victories: challenge next-level monster
    const nextMonster = allMonsters.find((m) => m.level > maxDefeatedLevel) || allMonsters[allMonsters.length - 1];
    dialogue = getVictoryDialogue(npc, nextMonster);
    taskData = {
      player_id: player.player_id,
      npc_id: npc.npc_id,
      title: `讨伐${nextMonster.name}`,
      description: `情报显示前方出现了${nextMonster.name}的踪迹。前去消灭 1 只${nextMonster.name}，清除威胁。`,
      conditions: [
        {
          type: 'kill_monster',
          target_id: nextMonster.monster_id,
          required_count: 1,
        },
      ],
      awards: [
        { type: 'exp', value: nextMonster.exp_reward },
        { type: 'gold', value: nextMonster.gold_reward },
      ],
    };
  } else {
    // Fallback: basic slime quest
    dialogue = getDefaultDialogue(npc);
    taskData = {
      player_id: player.player_id,
      npc_id: npc.npc_id,
      title: '清除史莱姆',
      description: '附近出现了一些史莱姆，去消灭 2 只吧。',
      conditions: [
        { type: 'kill_monster', target_id: 'slime_01', required_count: 1 },
      ],
      awards: [
        { type: 'exp', value: 15 },
        { type: 'gold', value: 8 },
      ],
    };
  }

  // Check for duplicate tasks (same conditions as an active task)
  const isDuplicate = active.some((t) => {
    if (t.conditions.length !== taskData.conditions.length) return false;
    return t.conditions.every((c, i) => {
      const nc = taskData.conditions[i];
      return c.type === nc.type && c.target_id === nc.target_id;
    });
  });

  if (isDuplicate) {
    // If duplicate, just provide dialogue without a new task
    return {
      dialogue: `${npc.name}：你之前接的任务还没完成呢，先去完成吧！`,
      task: null,
    };
  }

  // Create the task through TaskManager (with validation)
  const result = taskManager.createTask(taskData);

  if (!result.success) {
    console.error('Task creation failed:', result.errors);
    return {
      dialogue: `${npc.name}：今天没什么特别的事情，你先去四处看看吧。`,
      task: null,
    };
  }

  return {
    dialogue,
    task: result.task,
  };
}

// ---- Dialogue text generators ----

function getNewPlayerDialogue(npc) {
  const dialogues = {
    npc_elder: '村长老莫：年轻人，千里之行始于足下。村子东边的草地上有史莱姆，去消灭 1 只练练手吧。回来我有奖励给你。',
    npc_blacksmith: '铁匠格雷：哟，新来的冒险者！先去练练手吧，东边的史莱姆正好适合你。',
    npc_merchant: '商人莉娜：嘿嘿，新手冒险者！去打几只史莱姆赚点金币，回来找我买装备哦～',
    npc_healer: '药师艾琳：欢迎来到村子。先去试试和史莱姆战斗吧，受伤了记得回来找我。',

  };
  return dialogues[npc.npc_id] || `${npc.name}：去消灭一些史莱姆练练手吧。`;
}

function getVictoryDialogue(npc, nextMonster) {
  const dialogues = {
    npc_elder: `村长老莫：不错不错，看来你已经成长了不少。听说前方出现了${nextMonster.name}，去看看吧。`,
    npc_blacksmith: `铁匠格雷：哈哈，越来越强了嘛！该挑战${nextMonster.name}了，去吧！`,
    npc_merchant: `商人莉娜：实力不错嘛～我听说${nextMonster.name}身上有好东西，去试试？`,
    npc_healer: `药师艾琳：你恢复得很好呢。准备好了吗？前方有${nextMonster.name}出没，小心哦。`,
  };
  return dialogues[npc.npc_id] || `${npc.name}：去挑战${nextMonster.name}吧！`;
}

function getDefeatHealDialogue(npc) {
  const dialogues = {
    npc_elder: '村长老莫：孩子，磨刀不误砍柴工。先把伤养好再出发吧。',
    npc_blacksmith: '铁匠格雷：哎呀，伤成这样可不行！先喝瓶药恢复一下。',
    npc_merchant: '商人莉娜：你这样子可没法战斗啊～快用背包里的药水吧。',
    npc_healer: '药师艾琳：你的气色看起来很差呢……背包里不是有药水吗？先喝一瓶恢复一下体力吧。',
  };
  return dialogues[npc.npc_id] || `${npc.name}：先恢复体力再战斗吧。`;
}

function getDefeatEquipDialogue(npc) {
  const dialogues = {
    npc_elder: '村长老莫：实力不够就要靠装备弥补。去收集些材料提升自己吧。',
    npc_blacksmith: '铁匠格雷：光有把好剑可不行！你的防御太薄了。去猎几只怪物，带皮革碎片回来，我给你打一件皮甲！',
    npc_merchant: '商人莉娜：看你被打得够惨的……需要更好的装备呢。去收集些材料吧～',
    npc_healer: '药师艾琳：你受了不少伤呢……或许该加强一下装备了。去收集些材料吧。',
  };
  return dialogues[npc.npc_id] || `${npc.name}：去收集材料提升装备吧。`;
}

function getDefaultDialogue(npc) {
  return `${npc.name}：附近有些怪物需要清理，去帮忙吧。`;
}

/**
 * Check if player has a specific consumable in inventory.
 */
function hasConsumableInInventory(player, itemId) {
  if (!player.inventory) return false;
  return player.inventory.some((i) => i.item_id === itemId && i.quantity > 0);
}

/**
 * Call the NPC Agent via AgentCore Runtime (production mode).
 */
async function callNPCAgentAgentCore(playerId, npcId) {
  const { BedrockAgentCoreClient, InvokeAgentRuntimeCommand } = require('@aws-sdk/client-bedrock-agentcore');
  const client = new BedrockAgentCoreClient({
    region: process.env.AWS_REGION || 'us-west-2',
  });

  const payload = JSON.stringify({ player_id: playerId, npc_id: npcId });
  const command = new InvokeAgentRuntimeCommand({
    agentRuntimeArn: process.env.AGENTCORE_ENDPOINT_ARN,
    contentType: 'application/json',
    accept: 'application/json',
    payload: Buffer.from(payload),
  });

  const response = await client.send(command);

  // Read the streaming response body
  const chunks = [];
  for await (const chunk of response.response) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  const body = Buffer.concat(chunks).toString('utf-8');
  return JSON.parse(body);
}

/**
 * Call the NPC Agent API via HTTP (local dev / fallback mode).
 */
async function callNPCAgentHTTP(playerId, npcId) {
  const url = process.env.NPC_AGENT_URL;
  const response = await fetch(`${url}/dialogue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ player_id: playerId, npc_id: npcId }),
  });

  if (!response.ok) {
    throw new Error(`NPC Agent API returned ${response.status}`);
  }

  return await response.json();
}

/**
 * Call the NPC Agent — routes to AgentCore (production) or HTTP (local dev).
 */
async function callNPCAgentAPI(playerId, npcId) {
  if (process.env.AGENTCORE_ENDPOINT_ARN) {
    return callNPCAgentAgentCore(playerId, npcId);
  }
  return callNPCAgentHTTP(playerId, npcId);
}

module.exports = {
  handleNPCDialogue,
  handleTaskAccept,
  handleTaskReject,
};
