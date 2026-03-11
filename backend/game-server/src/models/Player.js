const { v4: uuidv4 } = require('uuid');

const PLAYER_DEFAULTS = {
  name: '勇者',
  level: 1,
  exp: 0,
  exp_to_next_level: 50,
  gold: 0,
  hp: 100,
  max_hp: 100,
  attack: 15,
  defense: 5,
  inventory: [],
  active_tasks: [],
  completed_tasks: [],
  position_x: 400,
  position_y: 300,
};

/**
 * Create a new player object with defaults.
 * @param {string} [name] - Player name, defaults to '勇者'
 * @returns {object} Full player data object
 */
function createPlayerData(name, playerId) {
  const now = new Date().toISOString();
  return {
    player_id: playerId || uuidv4(),
    ...PLAYER_DEFAULTS,
    name: name || PLAYER_DEFAULTS.name,
    created_at: now,
    updated_at: now,
  };
}

/**
 * Calculate exp required for next level.
 * Formula: 50 * level^1.5 (rounded)
 */
function expForLevel(level) {
  return Math.round(50 * Math.pow(level, 1.5));
}

/**
 * Try to level up the player. Mutates the player object.
 * Returns true if leveled up.
 */
function tryLevelUp(player) {
  let leveled = false;
  while (player.exp >= player.exp_to_next_level) {
    player.exp -= player.exp_to_next_level;
    player.level += 1;
    player.exp_to_next_level = expForLevel(player.level);
    // Stat boosts on level up
    player.max_hp += 20;
    player.hp = player.max_hp;
    player.attack += 5;
    player.defense += 2;
    leveled = true;
  }
  return leveled;
}

module.exports = {
  PLAYER_DEFAULTS,
  createPlayerData,
  expForLevel,
  tryLevelUp,
};
