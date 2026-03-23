const playerDataService = require('../services/PlayerDataService');
const taskManager = require('../services/TaskManager');
const InventoryManager = require('../services/InventoryManager');
const eventEmitter = require('../services/EventEmitter');
const taskPreGenerator = require('../services/TaskPreGenerator');

/**
 * Task REST API handlers.
 * GET  /api/tasks/:playerId        - Get all player tasks
 * POST /api/tasks/:taskId/complete  - Complete a task
 */

/**
 * Get all tasks for a player.
 * Returns active and completed tasks.
 */
async function handleGetTasks(req, res) {
  try {
    const { playerId } = req.params;

    if (!playerId) {
      return res.status(400).json({
        success: false,
        message: 'playerId is required',
      });
    }

    const player = await playerDataService.getPlayer(playerId);
    if (!player) {
      return res.status(404).json({
        success: false,
        message: `Player not found: ${playerId}`,
      });
    }

    const tasks = taskManager.getPlayerTasks(playerId);

    return res.json({
      success: true,
      active_tasks: tasks.active,
      completed_tasks: tasks.completed,
    });
  } catch (err) {
    console.error('Error in handleGetTasks:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
}

/**
 * Complete a task.
 * Server validates that all conditions are met before granting rewards.
 * Body: { player_id: string }
 */
async function handleCompleteTask(req, res) {
  try {
    const { taskId } = req.params;
    const { player_id } = req.body || {};

    if (!taskId || !player_id) {
      return res.status(400).json({
        success: false,
        message: 'taskId (in URL) and player_id (in body) are required',
      });
    }

    const player = await playerDataService.getPlayer(player_id);
    if (!player) {
      return res.status(404).json({
        success: false,
        message: `Player not found: ${player_id}`,
      });
    }

    const result = taskManager.completeTask(player, taskId);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.message,
        conditions: result.conditions || null,
      });
    }

    // Log event
    eventEmitter.logEvent(player_id, 'task_completed', taskId, 'success', {
      task_id: taskId,
      title: result.task?.title,
      rewards: result.rewards,
    });

    // Save updated player
    await playerDataService.savePlayer(player);

    // Trigger pre-generation for next task
    taskPreGenerator.triggerPreGeneration(player_id, 'task_completed', {
      task_id: taskId,
      title: result.task?.title,
    });

    return res.json({
      success: true,
      task: result.task,
      rewards: result.rewards,
      player,
    });
  } catch (err) {
    console.error('Error in handleCompleteTask:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
}

/**
 * WebSocket handler for item usage (which may trigger task progress).
 * Message: { type: "use_item", player_id, item_id }
 */
async function handleUseItem(ws, message) {
  const { player_id, item_id } = message;
  console.log(`[HANDLER] use_item: player=${player_id}, item=${item_id}`);

  if (!player_id || !item_id) {
    ws.send(
      JSON.stringify({
        type: 'error',
        message: 'player_id and item_id are required',
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

  // Use the item
  const result = InventoryManager.useItem(player, item_id);

  if (!result.success) {
    ws.send(
      JSON.stringify({
        type: 'use_item_result',
        success: false,
        message: result.message,
      })
    );
    return;
  }

  // Log event
  eventEmitter.logEvent(player_id, 'item_used', item_id, 'success', {
    item_id,
    effect: result.effect,
  });

  // Check task progress for use_item
  const taskUpdates = taskManager.checkTaskProgress(player, 'use_item', item_id);

  ws.send(
    JSON.stringify({
      type: 'use_item_result',
      success: true,
      item_id,
      message: result.message,
      effect: result.effect,
      items_received: result.items_received || null,
      player_hp: player.hp,
      player_max_hp: player.max_hp,
      player_attack: player.attack,
      player_defense: player.defense,
    })
  );

  // Send task progress if updated
  if (taskUpdates.length > 0) {
    ws.send(
      JSON.stringify({
        type: 'task_progress',
        updates: taskUpdates,
      })
    );

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
  }

  // Save player
  await playerDataService.savePlayer(player);

  // Trigger pre-generation on item use
  taskPreGenerator.triggerPreGeneration(player_id, 'item_used', {
    item_id,
    effect: result.effect,
  });
}

module.exports = {
  handleGetTasks,
  handleCompleteTask,
  handleUseItem,
};
