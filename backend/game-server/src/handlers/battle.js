const BattleSystem = require('../services/BattleSystem');
const playerDataService = require('../services/PlayerDataService');
const taskManager = require('../services/TaskManager');
const taskPreGenerator = require('../services/TaskPreGenerator');

/**
 * Battle handler for WebSocket messages.
 * Handles: { type: "battle_start", player_id: "...", monster_id: "..." }
 *
 * Sends back:
 *   - { type: "battle_start", ... }     (battle initiated)
 *   - { type: "battle_round", ... }     (one per round, for frontend animation)
 *   - { type: "battle_end", ... }       (final result with rewards)
 *   - { type: "task_progress", ... }    (if any task conditions were updated)
 */
async function handleBattle(ws, message) {
  const { player_id, monster_id } = message;
  console.log(`[HANDLER] battle_start: player=${player_id}, monster=${monster_id}`);

  if (!player_id || !monster_id) {
    ws.send(
      JSON.stringify({
        type: 'error',
        message: 'player_id and monster_id are required',
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

  // Execute battle
  const battleResult = BattleSystem.executeBattle(player, monster_id);

  if (!battleResult.success) {
    ws.send(
      JSON.stringify({
        type: 'error',
        message: battleResult.message,
      })
    );
    return;
  }

  // Send battle start notification
  ws.send(
    JSON.stringify({
      type: 'battle_start',
      monster_id: battleResult.monster_id,
      monster_name: battleResult.monster_name,
      total_rounds: battleResult.rounds.length,
    })
  );

  // Send each round incrementally (with a small delay for frontend animation)
  for (let i = 0; i < battleResult.rounds.length; i++) {
    const round = battleResult.rounds[i];

    // Use setTimeout to stagger round delivery
    await new Promise((resolve) => setTimeout(resolve, 100));

    ws.send(
      JSON.stringify({
        type: 'battle_round',
        ...round,
        is_last_round: i === battleResult.rounds.length - 1,
      })
    );
  }

  // Send battle end result
  const battleEndMsg = {
    type: 'battle_end',
    result: battleResult.result,
    rewards: battleResult.rewards,
    player_hp_after: battleResult.player_hp_after,
    respawn_position: battleResult.respawn_position || null,
  };
  console.log(`[WS:SEND] battle_end: result=${battleResult.result}, rounds=${battleResult.rounds.length}`, JSON.stringify(battleEndMsg));
  ws.send(JSON.stringify(battleEndMsg));

  // Check task progress if victory
  let anyTaskCompleted = false;
  if (battleResult.result === 'victory') {
    const taskUpdates = taskManager.checkTaskProgress(
      player,
      'kill_monster',
      monster_id
    );

    if (taskUpdates.length > 0) {
      ws.send(
        JSON.stringify({
          type: 'task_progress',
          updates: taskUpdates,
        })
      );

      // Auto-complete tasks whose conditions are all met
      for (const update of taskUpdates) {
        if (update.taskComplete) {
          anyTaskCompleted = true;
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
    }
  }

  // Save updated player data
  await playerDataService.savePlayer(player);

  // Trigger pre-generation only if no task was completed in this battle.
  // If a task was completed, pre-generation will be triggered from the
  // task_complete handler after DynamoDB status is updated.
  if (!anyTaskCompleted) {
    taskPreGenerator.triggerPreGeneration(player_id, `battle_${battleResult.result}`, {
      monster_id,
      monster_name: battleResult.monster_name,
      rewards: battleResult.rewards,
    }, ws);
  }
}

module.exports = { handleBattle };
