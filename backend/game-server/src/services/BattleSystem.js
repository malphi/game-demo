const { getMonster } = require('../models/Monster');
const { tryLevelUp } = require('../models/Player');
const InventoryManager = require('./InventoryManager');
const eventEmitter = require('./EventEmitter');

/**
 * Battle system service.
 * Executes auto-battle between a player and a monster.
 */
const BattleSystem = {
  /**
   * Execute a complete battle between player and monster.
   * @param {object} player - Player data object (will be mutated)
   * @param {string} monsterId - Monster dictionary ID
   * @returns {{ success: boolean, result: string, rounds: Array, rewards?: object, message?: string }}
   */
  executeBattle(player, monsterId) {
    const monsterTemplate = getMonster(monsterId);
    if (!monsterTemplate) {
      return { success: false, message: `Monster not found: ${monsterId}` };
    }

    // Create a battle instance of the monster (copy so we can mutate hp)
    const monster = { ...monsterTemplate };
    const rounds = [];
    let roundNum = 0;

    // Save initial state for logging
    const initialPlayerHp = player.hp;

    while (player.hp > 0 && monster.hp > 0) {
      roundNum++;

      // Player attacks monster
      const playerDamage = Math.max(player.attack - monster.defense, 1);
      monster.hp -= playerDamage;

      const roundData = {
        round: roundNum,
        player_attack: {
          damage: playerDamage,
          monster_hp_after: Math.max(monster.hp, 0),
        },
        monster_attack: null,
      };

      // Check if monster is dead after player attack
      if (monster.hp <= 0) {
        monster.hp = 0;
        rounds.push(roundData);
        break;
      }

      // Monster attacks player
      const monsterDamage = Math.max(monster.attack - player.defense, 1);
      player.hp -= monsterDamage;

      roundData.monster_attack = {
        damage: monsterDamage,
        player_hp_after: Math.max(player.hp, 0),
      };

      rounds.push(roundData);

      // Safety: prevent infinite battles (max 100 rounds)
      if (roundNum >= 100) {
        break;
      }
    }

    // Determine outcome
    if (monster.hp <= 0) {
      // Player victory
      const rewards = this._calculateRewards(player, monsterTemplate);

      // Apply rewards
      player.exp += rewards.exp;
      player.gold += rewards.gold;

      // Add dropped items
      for (const drop of rewards.items) {
        InventoryManager.addItem(player, drop.item_id, 1);
      }

      // Check level up
      const leveledUp = tryLevelUp(player);

      // Log event
      eventEmitter.logEvent(player.player_id, 'battle_victory', monsterId, 'success', {
        monster_id: monsterId,
        damage_taken: initialPlayerHp - player.hp,
        rounds: roundNum,
        exp_gained: rewards.exp,
        gold_gained: rewards.gold,
        items_dropped: rewards.items.map((i) => i.item_id),
      });

      // Log level up if it happened
      if (leveledUp) {
        eventEmitter.logEvent(player.player_id, 'level_up', null, 'success', {
          new_level: player.level,
        });
      }

      // Log item acquisitions
      for (const drop of rewards.items) {
        eventEmitter.logEvent(player.player_id, 'item_acquired', drop.item_id, 'success', {
          item_id: drop.item_id,
          source: 'drop',
          monster_id: monsterId,
        });
      }

      return {
        success: true,
        result: 'victory',
        rounds,
        rewards: {
          exp: rewards.exp,
          gold: rewards.gold,
          items: rewards.items,
          leveled_up: leveledUp,
          new_level: player.level,
        },
        player_hp_after: player.hp,
        monster_id: monsterId,
        monster_name: monsterTemplate.name,
      };
    } else {
      // Player defeat
      eventEmitter.logEvent(player.player_id, 'battle_defeat', monsterId, 'failure', {
        monster_id: monsterId,
        player_hp_left: 0,
        monster_hp_left: monster.hp,
        rounds: roundNum,
      });

      // Reset player: restore to full HP, return to spawn
      player.hp = player.max_hp;
      player.position_x = 400;
      player.position_y = 300;

      return {
        success: true,
        result: 'defeat',
        rounds,
        rewards: null,
        player_hp_after: player.hp,
        monster_id: monsterId,
        monster_name: monsterTemplate.name,
        respawn_position: { x: 400, y: 300 },
      };
    }
  },

  /**
   * Calculate battle rewards based on monster template.
   * @param {object} player
   * @param {object} monsterTemplate
   * @returns {{ exp: number, gold: number, items: Array<{item_id: string}> }}
   */
  _calculateRewards(player, monsterTemplate) {
    const rewards = {
      exp: monsterTemplate.exp_reward,
      gold: monsterTemplate.gold_reward,
      items: [],
    };

    // Roll for item drops
    if (monsterTemplate.drop_items) {
      for (const drop of monsterTemplate.drop_items) {
        // Check drop_rate_boost from player equipment (e.g. lucky_ring)
        let dropBoost = 0;
        if (player.inventory) {
          // Simple check: if player has lucky_ring in inventory, boost drop rate
          const hasLuckyRing = player.inventory.find(
            (i) => i.item_id === 'lucky_ring' && i.quantity > 0
          );
          if (hasLuckyRing) {
            dropBoost = 0.1;
          }
        }

        const effectiveProbability = Math.min(drop.probability + dropBoost, 1.0);
        if (Math.random() < effectiveProbability) {
          rewards.items.push({ item_id: drop.item_id });
        }
      }
    }

    return rewards;
  },
};

module.exports = BattleSystem;
