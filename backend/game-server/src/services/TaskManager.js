const { v4: uuidv4 } = require('uuid');
const { createTaskData, VALID_CONDITION_TYPES } = require('../models/Task');
const { monsterExists } = require('../models/Monster');
const { itemExists } = require('../models/Item');
const { npcExists } = require('../models/NPC');
const InventoryManager = require('./InventoryManager');
const eventEmitter = require('./EventEmitter');

/**
 * Task management service.
 * Handles task creation, progress tracking, and completion.
 */
class TaskManager {
  constructor() {
    // In-memory task store: Map<taskId, taskData>
    this.tasks = new Map();
  }

  /**
   * Validate a task data object.
   * Returns { valid: boolean, errors: string[] }
   */
  validateTask(taskData) {
    const errors = [];

    // 1. Structure completeness
    for (const field of ['title', 'description', 'conditions', 'awards']) {
      if (!taskData[field] || (Array.isArray(taskData[field]) && taskData[field].length === 0)) {
        errors.push(`Missing or empty required field: ${field}`);
      }
    }
    if (errors.length > 0) {
      return { valid: false, errors };
    }

    // 2. npc_id validation
    if (taskData.npc_id && !npcExists(taskData.npc_id)) {
      errors.push(`npc_id does not exist in NPC dictionary: ${taskData.npc_id}`);
    }

    // 3. Condition validation
    const targetTableMap = {
      kill_monster: 'monster',
      collect_item: 'item',
      use_item: 'item',
      talk_to_npc: 'npc',
    };

    for (const cond of taskData.conditions || []) {
      if (!VALID_CONDITION_TYPES.includes(cond.type)) {
        errors.push(`Unsupported condition type: ${cond.type}`);
        continue;
      }

      // Validate target_id exists in the appropriate dictionary
      const targetType = targetTableMap[cond.type];
      if (targetType === 'monster' && !monsterExists(cond.target_id)) {
        errors.push(`Monster target_id does not exist: ${cond.target_id}`);
      } else if (targetType === 'item' && !itemExists(cond.target_id)) {
        errors.push(`Item target_id does not exist: ${cond.target_id}`);
      } else if (targetType === 'npc' && !npcExists(cond.target_id)) {
        errors.push(`NPC target_id does not exist: ${cond.target_id}`);
      }

      // Validate required_count range
      const count = cond.required_count;
      if (count === undefined || count === null || count < 1 || count > 99) {
        errors.push(`required_count out of range (1-99): ${count}`);
      }
    }

    // 4. Award validation
    for (const award of taskData.awards || []) {
      if (award.type === 'item') {
        if (!award.item_id || !itemExists(award.item_id)) {
          errors.push(`Award item_id does not exist: ${award.item_id}`);
        }
        const qty = award.quantity;
        if (qty === undefined || qty === null || qty < 1 || qty > 99) {
          errors.push(`Award item quantity out of range (1-99): ${qty}`);
        }
      } else if (award.type === 'gold') {
        if (!award.value || award.value < 1 || award.value > 1000) {
          errors.push(`Gold award out of range (1-1000): ${award.value}`);
        }
      } else if (award.type === 'exp') {
        if (!award.value || award.value < 1 || award.value > 500) {
          errors.push(`Exp award out of range (1-500): ${award.value}`);
        }
      } else {
        errors.push(`Unknown award type: ${award.type}`);
      }
    }

    if (errors.length > 0) {
      return { valid: false, errors };
    }
    return { valid: true, errors: [] };
  }

  /**
   * Create and store a new task.
   * @param {object} taskInput - Task data including player_id, npc_id, title, description, conditions, awards
   * @returns {{ success: boolean, task?: object, errors?: string[] }}
   */
  createTask(taskInput) {
    const validation = this.validateTask(taskInput);
    if (!validation.valid) {
      return { success: false, errors: validation.errors };
    }

    const taskId = uuidv4();
    const task = createTaskData({
      task_id: taskId,
      player_id: taskInput.player_id,
      npc_id: taskInput.npc_id,
      title: taskInput.title,
      description: taskInput.description,
      conditions: taskInput.conditions,
      awards: taskInput.awards,
    });

    this.tasks.set(taskId, task);

    return { success: true, task };
  }

  /**
   * Get a task by ID.
   * @param {string} taskId
   * @returns {object|null}
   */
  getTask(taskId) {
    return this.tasks.get(taskId) || null;
  }

  /**
   * Get all tasks for a player.
   * @param {string} playerId
   * @returns {{ active: Array, completed: Array }}
   */
  getPlayerTasks(playerId) {
    const active = [];
    const completed = [];

    for (const task of this.tasks.values()) {
      if (task.player_id === playerId) {
        if (task.status === 'completed') {
          completed.push(task);
        } else {
          active.push(task);
        }
      }
    }

    return { active, completed };
  }

  /**
   * Check and update task progress based on a player event.
   * This is called after battles, item pickups, NPC interactions, item usage, etc.
   * @param {object} player - Player data
   * @param {string} eventType - The type of event: 'kill_monster', 'collect_item', 'talk_to_npc', 'use_item'
   * @param {string} targetId - The target_id (monster_id, item_id, npc_id)
   * @returns {Array<{ taskId: string, conditionMet: boolean, taskComplete: boolean }>} Progress updates
   */
  checkTaskProgress(player, eventType, targetId) {
    const updates = [];
    const playerTasks = this.getPlayerTasks(player.player_id);

    for (const task of playerTasks.active) {
      if (task.status === 'completed') continue;

      // Activate pending tasks that the player has accepted
      if (task.status === 'pending' && player.active_tasks.includes(task.task_id)) {
        task.status = 'in_progress';
      }

      if (task.status !== 'in_progress') continue;

      let conditionUpdated = false;

      for (const condition of task.conditions) {
        if (condition.type === eventType && condition.target_id === targetId) {
          if (condition.current_count < condition.required_count) {
            condition.current_count += 1;
            conditionUpdated = true;
          }
        }
      }

      if (conditionUpdated) {
        // Check if all conditions are met
        const allMet = task.conditions.every(
          (c) => c.current_count >= c.required_count
        );

        updates.push({
          taskId: task.task_id,
          title: task.title,
          conditionMet: conditionUpdated,
          taskComplete: allMet,
          conditions: task.conditions,
        });
      }
    }

    return updates;
  }

  /**
   * Complete a task: validate conditions are met, apply rewards, mark as completed.
   * @param {object} player - Player data (will be mutated)
   * @param {string} taskId
   * @returns {{ success: boolean, message?: string, rewards?: object }}
   */
  completeTask(player, taskId) {
    const task = this.tasks.get(taskId);
    if (!task) {
      return { success: false, message: `Task not found: ${taskId}` };
    }

    if (task.player_id !== player.player_id) {
      return { success: false, message: 'This task does not belong to the player' };
    }

    if (task.status === 'completed') {
      return { success: false, message: 'Task already completed' };
    }

    // Verify all conditions are met
    const allMet = task.conditions.every(
      (c) => c.current_count >= c.required_count
    );
    if (!allMet) {
      return {
        success: false,
        message: 'Not all conditions are met',
        conditions: task.conditions,
      };
    }

    // Apply rewards
    const rewardsApplied = { exp: 0, gold: 0, items: [] };

    for (const award of task.awards) {
      switch (award.type) {
        case 'exp':
          player.exp += award.value;
          rewardsApplied.exp += award.value;
          break;
        case 'gold':
          player.gold += award.value;
          rewardsApplied.gold += award.value;
          break;
        case 'item':
          InventoryManager.addItem(player, award.item_id, award.quantity);
          rewardsApplied.items.push({
            item_id: award.item_id,
            quantity: award.quantity,
          });
          break;
      }
    }

    // For collect_item conditions, remove the collected items from inventory
    for (const condition of task.conditions) {
      if (condition.type === 'collect_item') {
        InventoryManager.removeItem(player, condition.target_id, condition.required_count);
      }
    }

    // Check level up after exp reward
    const { tryLevelUp } = require('../models/Player');
    const leveledUp = tryLevelUp(player);
    if (leveledUp) {
      rewardsApplied.leveled_up = true;
      rewardsApplied.new_level = player.level;
      eventEmitter.logEvent(player.player_id, 'level_up', null, 'success', {
        new_level: player.level,
      });
    }

    // Mark task as completed
    task.status = 'completed';
    task.completed_at = new Date().toISOString();

    // Update player's task lists
    player.active_tasks = player.active_tasks.filter((id) => id !== taskId);
    if (!player.completed_tasks.includes(taskId)) {
      player.completed_tasks.push(taskId);
    }

    // Log event
    eventEmitter.logEvent(player.player_id, 'task_completed', taskId, 'success', {
      task_id: taskId,
      title: task.title,
      awards: task.awards,
    });

    return { success: true, rewards: rewardsApplied, task };
  }
}

// Singleton
const taskManager = new TaskManager();

module.exports = taskManager;
