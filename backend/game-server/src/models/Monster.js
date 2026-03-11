/**
 * Monster dictionary data.
 * All monsters must be pre-defined here. NPC Agent can only reference these monster_ids.
 */

const MONSTERS = {
  slime_01: {
    monster_id: 'slime_01',
    name: '史莱姆',
    level: 1,
    hp: 40,
    attack: 15,
    defense: 3,
    exp_reward: 10,
    gold_reward: 5,
    drop_items: [
      { item_id: 'leather_armor', probability: 1.0 },
    ],
    sprite: 'slime',
  },
  goblin_01: {
    monster_id: 'goblin_01',
    name: '哥布林',
    level: 2,
    hp: 70,
    attack: 22,
    defense: 8,
    exp_reward: 25,
    gold_reward: 15,
    drop_items: [
      { item_id: 'iron_ore', probability: 0.4 },
      { item_id: 'hp_potion_s', probability: 0.3 },
    ],
    sprite: 'goblin',
  },
  wolf_01: {
    monster_id: 'wolf_01',
    name: '灰狼',
    level: 3,
    hp: 100,
    attack: 28,
    defense: 12,
    exp_reward: 45,
    gold_reward: 25,
    drop_items: [
      { item_id: 'wolf_fang', probability: 0.5 },
      { item_id: 'leather_scrap', probability: 0.6 },
    ],
    sprite: 'wolf',
  },
  orc_01: {
    monster_id: 'orc_01',
    name: '兽人战士',
    level: 4,
    hp: 120,
    attack: 32,
    defense: 15,
    exp_reward: 80,
    gold_reward: 50,
    drop_items: [
      { item_id: 'iron_ore', probability: 0.6 },
      { item_id: 'orc_shield_fragment', probability: 0.3 },
    ],
    sprite: 'orc',
  },
  dragon_01: {
    monster_id: 'dragon_01',
    name: '幼龙',
    level: 5,
    hp: 140,
    attack: 36,
    defense: 17,
    exp_reward: 150,
    gold_reward: 100,
    drop_items: [
      { item_id: 'dragon_scale', probability: 0.4 },
      { item_id: 'flame_gem', probability: 0.2 },
    ],
    sprite: 'dragon',
  },
};

/**
 * Get a monster by ID. Returns a deep copy so the original is not mutated.
 */
function getMonster(monsterId) {
  const m = MONSTERS[monsterId];
  if (!m) return null;
  return JSON.parse(JSON.stringify(m));
}

/**
 * Get all monsters as an array.
 */
function getAllMonsters() {
  return Object.values(MONSTERS).map((m) => JSON.parse(JSON.stringify(m)));
}

/**
 * Check if a monster_id exists.
 */
function monsterExists(monsterId) {
  return monsterId in MONSTERS;
}

module.exports = {
  MONSTERS,
  getMonster,
  getAllMonsters,
  monsterExists,
};
