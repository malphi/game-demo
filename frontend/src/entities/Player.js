import Phaser from 'phaser';
import { PLAYER_INITIAL, ITEM_DICT } from '../data/GameData.js';

export default class Player extends Phaser.GameObjects.Sprite {
  constructor(scene, x, y) {
    super(scene, x, y, 'player');
    scene.add.existing(this);
    scene.physics.add.existing(this);

    // Player stats
    this.player_id = PLAYER_INITIAL.player_id;
    this.playerName = PLAYER_INITIAL.name;
    this.level = PLAYER_INITIAL.level;
    this.exp = PLAYER_INITIAL.exp;
    this.exp_to_next_level = PLAYER_INITIAL.exp_to_next_level;
    this.gold = PLAYER_INITIAL.gold;
    this.hp = PLAYER_INITIAL.hp;
    this.max_hp = PLAYER_INITIAL.max_hp;
    this.attackStat = PLAYER_INITIAL.attack;
    this.defenseStat = PLAYER_INITIAL.defense;
    this.inventory = [...PLAYER_INITIAL.inventory];
    this.active_tasks = [...PLAYER_INITIAL.active_tasks];
    this.completed_tasks = [...PLAYER_INITIAL.completed_tasks];

    this.speed = 160;
    this.isInBattle = false;
    this.isInDialogue = false;

    // Set up physics body
    this.body.setCollideWorldBounds(true);
    this.setScale(2);
    this.setDepth(10);
  }

  move(cursors) {
    if (this.isInBattle || this.isInDialogue) {
      this.body.setVelocity(0, 0);
      return;
    }

    let vx = 0;
    let vy = 0;

    if (cursors.left.isDown || cursors.keyA.isDown) {
      vx = -this.speed;
    } else if (cursors.right.isDown || cursors.keyD.isDown) {
      vx = this.speed;
    }

    if (cursors.up.isDown || cursors.keyW.isDown) {
      vy = -this.speed;
    } else if (cursors.down.isDown || cursors.keyS.isDown) {
      vy = this.speed;
    }

    // Normalize diagonal movement
    if (vx !== 0 && vy !== 0) {
      vx *= 0.707;
      vy *= 0.707;
    }

    this.body.setVelocity(vx, vy);
  }

  takeDamage(amount) {
    this.hp = Math.max(0, this.hp - amount);
    return this.hp;
  }

  heal(amount) {
    this.hp = Math.min(this.max_hp, this.hp + amount);
    return this.hp;
  }

  addExp(amount) {
    this.exp += amount;
    let leveledUp = false;
    while (this.exp >= this.exp_to_next_level) {
      this.exp -= this.exp_to_next_level;
      this.level++;
      this.max_hp += 10;
      this.hp = this.max_hp;
      this.attackStat += 3;
      this.defenseStat += 1;
      const expMap = { 1: 10, 2: 25, 3: 45, 4: 80, 5: 150 };
      this.exp_to_next_level = expMap[this.level] || this.level * 30;
      leveledUp = true;
    }
    if (leveledUp) {
      this.scene.events.emit('player-level-up', this);
    }
    return leveledUp;
  }

  addGold(amount) {
    this.gold += amount;
  }

  addItem(item_id, quantity = 1) {
    const existing = this.inventory.find((i) => i.item_id === item_id);
    if (existing) {
      existing.quantity += quantity;
    } else {
      this.inventory.push({ item_id, quantity });
    }
    // Check collect_item task conditions
    this.checkCollectItemTasks(item_id);
  }

  removeItem(item_id, quantity = 1) {
    const existing = this.inventory.find((i) => i.item_id === item_id);
    if (existing) {
      existing.quantity -= quantity;
      if (existing.quantity <= 0) {
        this.inventory = this.inventory.filter((i) => i.item_id !== item_id);
      }
      return true;
    }
    return false;
  }

  hasItem(item_id, quantity = 1) {
    const existing = this.inventory.find((i) => i.item_id === item_id);
    return existing && existing.quantity >= quantity;
  }

  useItem(item_id) {
    const itemData = ITEM_DICT[item_id];
    if (!itemData) return null;
    if (!this.hasItem(item_id)) return null;

    if (itemData.type === 'consumable') {
      const msgs = [];
      if (itemData.effect.hp_restore) {
        const before = this.hp;
        this.heal(itemData.effect.hp_restore);
        msgs.push(`HP +${this.hp - before}`);
      }
      if (itemData.effect.attack_boost) {
        this.attackStat += itemData.effect.attack_boost;
        msgs.push(`攻击 +${itemData.effect.attack_boost}`);
      }
      if (itemData.effect.defense_boost) {
        this.defenseStat += itemData.effect.defense_boost;
        msgs.push(`防御 +${itemData.effect.defense_boost}`);
      }
      this.removeItem(item_id, 1);
      this.checkUseItemTasks(item_id);
      return `使用 ${itemData.name}！${msgs.join(' ')}`;
    }

    if (itemData.type === 'equipment') {
      const msgs = [];
      const eff = itemData.effect || {};
      if (eff.attack) {
        this.attackStat += eff.attack;
        msgs.push(`攻击 +${eff.attack}`);
      }
      if (eff.defense) {
        this.defenseStat += eff.defense;
        msgs.push(`防御 +${eff.defense}`);
      }
      if (eff.max_hp) {
        this.max_hp += eff.max_hp;
        this.hp = Math.min(this.hp + eff.max_hp, this.max_hp);
        msgs.push(`生命上限 +${eff.max_hp}`);
      }
      this.removeItem(item_id, 1);
      this.checkUseItemTasks(item_id);
      return `装备 ${itemData.name}！${msgs.join(' ')}`;
    }

    return null;
  }

  acceptTask(task) {
    // Check if already accepted
    if (this.active_tasks.find((t) => t.task_id === task.task_id)) {
      return false;
    }
    if (this.completed_tasks.includes(task.task_id)) {
      return false;
    }
    const taskCopy = JSON.parse(JSON.stringify(task));
    taskCopy.status = 'in_progress';
    this.active_tasks.push(taskCopy);
    return true;
  }

  updateTaskProgress(type, target_id) {
    let anyUpdated = false;
    for (const task of this.active_tasks) {
      for (const cond of task.conditions) {
        if (cond.type === type && cond.target_id === target_id) {
          cond.current_count = Math.min(
            cond.current_count + 1,
            cond.required_count
          );
          anyUpdated = true;
        }
      }
      // Check if task is complete
      const allComplete = task.conditions.every(
        (c) => c.current_count >= c.required_count
      );
      if (allComplete && task.status !== 'completed') {
        task.status = 'completed';
        this.completeTask(task);
      }
    }
    return anyUpdated;
  }

  checkCollectItemTasks(item_id) {
    for (const task of this.active_tasks) {
      for (const cond of task.conditions) {
        if (cond.type === 'collect_item' && cond.target_id === item_id) {
          const invItem = this.inventory.find((i) => i.item_id === item_id);
          cond.current_count = Math.min(
            invItem ? invItem.quantity : 0,
            cond.required_count
          );
        }
      }
      const allComplete = task.conditions.every(
        (c) => c.current_count >= c.required_count
      );
      if (allComplete && task.status !== 'completed') {
        task.status = 'completed';
        this.completeTask(task);
      }
    }
  }

  checkUseItemTasks(item_id) {
    this.updateTaskProgress('use_item', item_id);
  }

  completeTask(task) {
    // Grant awards
    for (const award of task.awards) {
      switch (award.type) {
        case 'gold':
          this.addGold(award.value);
          break;
        case 'exp':
          this.addExp(award.value);
          break;
        case 'item':
          this.addItem(award.item_id, award.quantity);
          break;
      }
    }
    // Move from active to completed
    this.completed_tasks.push(task.task_id);
    this.active_tasks = this.active_tasks.filter(
      (t) => t.task_id !== task.task_id
    );

    // Emit task completed event
    this.scene.events.emit('task-completed', task);
  }

  respawn() {
    this.hp = this.max_hp;
    this.setPosition(400, 300);
    this.body.setVelocity(0, 0);
    this.isInBattle = false;
  }

  getState() {
    return {
      player_id: this.player_id,
      name: this.playerName,
      level: this.level,
      exp: this.exp,
      exp_to_next_level: this.exp_to_next_level,
      gold: this.gold,
      hp: this.hp,
      max_hp: this.max_hp,
      attack: this.attackStat,
      defense: this.defenseStat,
      inventory: this.inventory,
      active_tasks: this.active_tasks,
      completed_tasks: this.completed_tasks,
    };
  }
}
