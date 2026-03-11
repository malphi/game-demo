/**
 * NPC dictionary data.
 * All NPCs must be pre-defined here. NPC Agent can only reference these npc_ids.
 */

const NPCS = {
  npc_elder: {
    npc_id: 'npc_elder',
    name: '村长老莫',
    role: '村庄长老，负责新手引导和主线任务推进',
    personality: '慈祥稳重，说话简洁，喜欢用谚语教导年轻人',
    position_x: 500,
    position_y: 300,
    sprite: 'npc_elder',
  },
  npc_blacksmith: {
    npc_id: 'npc_blacksmith',
    name: '铁匠格雷',
    role: '武器店铁匠，指导玩家装备强化和材料收集',
    personality: '粗犷豪爽，热情直率，对武器和装备充满热忱',
    position_x: 350,
    position_y: 450,
    sprite: 'npc_blacksmith',
  },
  npc_merchant: {
    npc_id: 'npc_merchant',
    name: '商人莉娜',
    role: '流浪商人，提供道具交易相关任务和情报线索',
    personality: '精明狡黠，话语间夹带商业推销，但本性善良',
    position_x: 650,
    position_y: 400,
    sprite: 'npc_merchant',
  },
  npc_healer: {
    npc_id: 'npc_healer',
    name: '药师艾琳',
    role: '教堂药师，引导玩家使用药水和恢复类道具',
    personality: '温柔细心，关心玩家的健康状态，说话轻声细语',
    position_x: 480,
    position_y: 250,
    sprite: 'npc_healer',
  },
};

function getNPC(npcId) {
  const n = NPCS[npcId];
  if (!n) return null;
  return { ...n };
}

function getAllNPCs() {
  return Object.values(NPCS).map((n) => ({ ...n }));
}

function npcExists(npcId) {
  return npcId in NPCS;
}

module.exports = {
  NPCS,
  getNPC,
  getAllNPCs,
  npcExists,
};
