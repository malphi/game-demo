# 任务生成规则与奖励指南

游戏"勇者大陆"中 NPC 生成任务时必须遵守的规则。

## 任务类型定义

### kill_monster - 击杀怪物
- **条件格式**: {"type": "kill_monster", "target_id": "<monster_id>", "quantity": <数量>}
- **target_id**: 必须是怪物字典中存在的 monster_id
- **quantity**: 1-99 之间的整数

### collect_item - 收集道具
- **条件格式**: {"type": "collect_item", "target_id": "<item_id>", "quantity": <数量>}
- **target_id**: 必须是道具字典中存在的 item_id
- **quantity**: 1-99 之间的整数

### use_item - 使用道具
- **条件格式**: {"type": "use_item", "target_id": "<item_id>", "quantity": <数量>}
- **target_id**: 必须是道具字典中存在的 item_id
- **quantity**: 1-99 之间的整数

### talk_to_npc - 与 NPC 对话
- **条件格式**: {"type": "talk_to_npc", "target_id": "<npc_id>", "quantity": 1}
- **target_id**: 必须是 NPC 字典中存在的 npc_id
- **quantity**: 通常为 1

## NPC 任务类型限制

每个 NPC 只能发布特定类型的任务，不可跨界：

| NPC | npc_id | 可发布任务类型 |
|-----|--------|---------------|
| 村长老莫 | npc_elder | kill_monster |
| 药师艾琳 | npc_healer | use_item |
| 铁匠格雷 | npc_blacksmith | collect_item |
| 商人莉娜 | npc_merchant | use_item |
| 斥候阿克 | npc_scout | kill_monster |

## 怪物等级匹配规则

kill_monster 任务必须严格遵守：
- 只能指定等级等于玩家当前等级的怪物
- 等级对应关系：
  - 玩家等级 1 -> slime_01 (史莱姆)
  - 玩家等级 2 -> goblin_01 (哥布林)
  - 玩家等级 3 -> wolf_01 (灰狼)
  - 玩家等级 4 -> orc_01 (兽人战士)
  - 玩家等级 5 -> dragon_01 (幼龙)

## 奖励规则

### 奖励格式
```json
{
  "awards": {
    "exp": <经验值>,
    "gold": <金币>,
    "items": [{"item_id": "<item_id>", "quantity": <数量>}]
  }
}
```

### 数值范围
- **经验值 (exp)**: 1 - 500
- **金币 (gold)**: 1 - 1000
- **道具数量**: 1 - 99
- **awards.items 中的 item_id**: 必须来自道具字典中存在的 item_id

### 奖励参考标准
- 击杀低等级怪物：exp 10-30, gold 5-20
- 击杀中等级怪物：exp 30-80, gold 20-50
- 击杀高等级怪物：exp 80-200, gold 50-100
- 收集/使用道具任务：exp 10-50, gold 10-30

## 任务去重规则

- 不要创建与玩家已有任务（包括 pending、in_progress、completed 状态）目标相同的任务
- "目标相同"指：相同的 condition type + target_id 组合

## 任务生成策略

### 战斗胜利路线（玩家最近战斗多为胜利）
- 推荐挑战等级更高的怪物
- 或收集高级材料

### 战斗失败路线（玩家最近有战斗失败记录）
- 推荐收集装备道具提升实力
- 或使用药水恢复

### 新手引导路线（玩家无行为记录或等级 <= 1）
- 推荐击杀最低等级的怪物（slime_01）
- 任务简单，奖励适中
