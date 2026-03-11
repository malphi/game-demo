/**
 * Item dictionary data.
 * All items must be pre-defined here. NPC Agent can only reference these item_ids.
 */

const ITEMS = {
  // ---- Consumables ----
  hp_potion_s: {
    item_id: 'hp_potion_s',
    name: '小生命药水',
    description: '恢复 30 点生命值',
    type: 'consumable',
    sub_type: null,
    effect: { hp_restore: 30 },
    sprite: 'hp_potion_s',
  },
  hp_potion_m: {
    item_id: 'hp_potion_m',
    name: '中生命药水',
    description: '恢复 80 点生命值',
    type: 'consumable',
    sub_type: null,
    effect: { hp_restore: 80 },
    sprite: 'hp_potion_m',
  },
  hp_potion_l: {
    item_id: 'hp_potion_l',
    name: '大生命药水',
    description: '恢复 200 点生命值',
    type: 'consumable',
    sub_type: null,
    effect: { hp_restore: 200 },
    sprite: 'hp_potion_l',
  },
  atk_potion: {
    item_id: 'atk_potion',
    name: '力量药剂',
    description: '攻击力临时提升 10，持续 3 场战斗',
    type: 'consumable',
    sub_type: null,
    effect: { attack_boost: 10, duration_battles: 3 },
    sprite: 'atk_potion',
  },
  def_potion: {
    item_id: 'def_potion',
    name: '铁壁药剂',
    description: '防御力临时提升 10，持续 3 场战斗',
    type: 'consumable',
    sub_type: null,
    effect: { defense_boost: 10, duration_battles: 3 },
    sprite: 'def_potion',
  },

  // ---- Equipment: Weapons ----
  wooden_sword: {
    item_id: 'wooden_sword',
    name: '木剑',
    description: '新手武器，聊胜于无',
    type: 'equipment',
    sub_type: 'weapon',
    effect: { attack: 3 },
    sprite: 'wooden_sword',
  },
  iron_sword: {
    item_id: 'iron_sword',
    name: '铁剑',
    description: '可靠的铁制长剑',
    type: 'equipment',
    sub_type: 'weapon',
    effect: { attack: 8 },
    sprite: 'iron_sword',
  },
  steel_sword: {
    item_id: 'steel_sword',
    name: '钢剑',
    description: '精锻钢制长剑，锋利无比',
    type: 'equipment',
    sub_type: 'weapon',
    effect: { attack: 15 },
    sprite: 'steel_sword',
  },
  flame_blade: {
    item_id: 'flame_blade',
    name: '烈焰之刃',
    description: '附着火焰魔力的武器',
    type: 'equipment',
    sub_type: 'weapon',
    effect: { attack: 25, fire_damage: 5 },
    sprite: 'flame_blade',
  },

  // ---- Equipment: Armor ----
  cloth_armor: {
    item_id: 'cloth_armor',
    name: '布甲',
    description: '简单的布制衣物',
    type: 'equipment',
    sub_type: 'armor',
    effect: { defense: 2 },
    sprite: 'cloth_armor',
  },
  leather_armor: {
    item_id: 'leather_armor',
    name: '皮甲',
    description: '皮革制作的轻便护甲',
    type: 'equipment',
    sub_type: 'armor',
    effect: { defense: 5 },
    sprite: 'leather_armor',
  },
  iron_armor: {
    item_id: 'iron_armor',
    name: '铁甲',
    description: '坚固的铁制护甲',
    type: 'equipment',
    sub_type: 'armor',
    effect: { defense: 12 },
    sprite: 'iron_armor',
  },
  dragon_armor: {
    item_id: 'dragon_armor',
    name: '龙鳞甲',
    description: '由龙鳞打造的传说护甲',
    type: 'equipment',
    sub_type: 'armor',
    effect: { defense: 22, max_hp: 50 },
    sprite: 'dragon_armor',
  },

  // ---- Equipment: Accessories ----
  lucky_ring: {
    item_id: 'lucky_ring',
    name: '幸运戒指',
    description: '提升道具掉落概率',
    type: 'equipment',
    sub_type: 'accessory',
    effect: { drop_rate_boost: 0.1 },
    sprite: 'lucky_ring',
  },
  warrior_amulet: {
    item_id: 'warrior_amulet',
    name: '勇士护符',
    description: '全面提升少量战斗属性',
    type: 'equipment',
    sub_type: 'accessory',
    effect: { attack: 3, defense: 3, max_hp: 20 },
    sprite: 'warrior_amulet',
  },

  // ---- Materials ----
  leather_scrap: {
    item_id: 'leather_scrap',
    name: '皮革碎片',
    description: '击杀野兽掉落，可制作皮甲',
    type: 'material',
    sub_type: null,
    effect: null,
    sprite: 'leather_scrap',
  },
  iron_ore: {
    item_id: 'iron_ore',
    name: '铁矿石',
    description: '击杀哥布林掉落，可锻造铁制装备',
    type: 'material',
    sub_type: null,
    effect: null,
    sprite: 'iron_ore',
  },
  wolf_fang: {
    item_id: 'wolf_fang',
    name: '狼牙',
    description: '击杀灰狼掉落，可制作饰品',
    type: 'material',
    sub_type: null,
    effect: null,
    sprite: 'wolf_fang',
  },
  orc_shield_fragment: {
    item_id: 'orc_shield_fragment',
    name: '兽人盾碎片',
    description: '击杀兽人掉落，可强化护甲',
    type: 'material',
    sub_type: null,
    effect: null,
    sprite: 'orc_shield_fragment',
  },
  dragon_scale: {
    item_id: 'dragon_scale',
    name: '龙鳞',
    description: '击杀幼龙掉落，传说级材料',
    type: 'material',
    sub_type: null,
    effect: null,
    sprite: 'dragon_scale',
  },
  flame_gem: {
    item_id: 'flame_gem',
    name: '火焰宝石',
    description: '击杀幼龙稀有掉落，附魔武器用',
    type: 'material',
    sub_type: null,
    effect: null,
    sprite: 'flame_gem',
  },

  // ---- Gift Packs ----
  starter_pack: {
    item_id: 'starter_pack',
    name: '新手礼包',
    description: '包含新手必备物品',
    type: 'gift_pack',
    sub_type: null,
    effect: {
      contains: [
        { item_id: 'hp_potion_s', quantity: 5 },
        { item_id: 'wooden_sword', quantity: 1 },
        { item_id: 'cloth_armor', quantity: 1 },
      ],
    },
    sprite: 'starter_pack',
  },
  warrior_pack: {
    item_id: 'warrior_pack',
    name: '战士补给包',
    description: '为战斗准备的补给',
    type: 'gift_pack',
    sub_type: null,
    effect: {
      contains: [
        { item_id: 'hp_potion_m', quantity: 3 },
        { item_id: 'atk_potion', quantity: 2 },
        { item_id: 'def_potion', quantity: 2 },
      ],
    },
    sprite: 'warrior_pack',
  },
  treasure_box: {
    item_id: 'treasure_box',
    name: '宝藏箱',
    description: '打开后随机获得装备或材料',
    type: 'gift_pack',
    sub_type: null,
    effect: {
      random_one_of: [
        { item_id: 'iron_sword' },
        { item_id: 'leather_armor' },
        { item_id: 'lucky_ring' },
        { item_id: 'iron_ore', quantity: 5 },
      ],
    },
    sprite: 'treasure_box',
  },
};

function getItem(itemId) {
  const item = ITEMS[itemId];
  if (!item) return null;
  return JSON.parse(JSON.stringify(item));
}

function getAllItems() {
  return Object.values(ITEMS).map((i) => JSON.parse(JSON.stringify(i)));
}

function itemExists(itemId) {
  return itemId in ITEMS;
}

module.exports = {
  ITEMS,
  getItem,
  getAllItems,
  itemExists,
};
