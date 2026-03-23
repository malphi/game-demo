# 道具字典 (Items)

游戏"勇者大陆"中所有可用道具的完整列表。任务的 conditions 和 awards 中引用的 item_id 必须来自此列表。

## 消耗品 (Consumable)

### hp_potion_s - 小生命药水

- **item_id**: hp_potion_s
- **名称**: 小生命药水
- **描述**: 恢复 30 点生命值
- **类型**: consumable
- **效果**: hp_restore: 30

### hp_potion_m - 中生命药水

- **item_id**: hp_potion_m
- **名称**: 中生命药水
- **描述**: 恢复 80 点生命值
- **类型**: consumable
- **效果**: hp_restore: 80

### hp_potion_l - 大生命药水

- **item_id**: hp_potion_l
- **名称**: 大生命药水
- **描述**: 恢复 200 点生命值
- **类型**: consumable
- **效果**: hp_restore: 200

### atk_potion - 力量药剂

- **item_id**: atk_potion
- **名称**: 力量药剂
- **描述**: 攻击力临时提升 10，持续 3 场战斗
- **类型**: consumable
- **效果**: attack_boost: 10, duration_battles: 3

### def_potion - 铁壁药剂

- **item_id**: def_potion
- **名称**: 铁壁药剂
- **描述**: 防御力临时提升 10，持续 3 场战斗
- **类型**: consumable
- **效果**: defense_boost: 10, duration_battles: 3

## 装备 - 武器 (Equipment - Weapon)

### wooden_sword - 木剑

- **item_id**: wooden_sword
- **名称**: 木剑
- **描述**: 新手武器，聊胜于无
- **类型**: equipment
- **子类型**: weapon
- **效果**: attack: 3

### iron_sword - 铁剑

- **item_id**: iron_sword
- **名称**: 铁剑
- **描述**: 可靠的铁制长剑
- **类型**: equipment
- **子类型**: weapon
- **效果**: attack: 8

### steel_sword - 钢剑

- **item_id**: steel_sword
- **名称**: 钢剑
- **描述**: 精锻钢制长剑，锋利无比
- **类型**: equipment
- **子类型**: weapon
- **效果**: attack: 15

### flame_blade - 烈焰之刃

- **item_id**: flame_blade
- **名称**: 烈焰之刃
- **描述**: 附着火焰魔力的武器
- **类型**: equipment
- **子类型**: weapon
- **效果**: attack: 25, fire_damage: 5

## 装备 - 护甲 (Equipment - Armor)

### cloth_armor - 布甲

- **item_id**: cloth_armor
- **名称**: 布甲
- **描述**: 简单的布制衣物
- **类型**: equipment
- **子类型**: armor
- **效果**: defense: 2

### leather_armor - 皮甲

- **item_id**: leather_armor
- **名称**: 皮甲
- **描述**: 皮革制作的轻便护甲
- **类型**: equipment
- **子类型**: armor
- **效果**: defense: 5

### iron_armor - 铁甲

- **item_id**: iron_armor
- **名称**: 铁甲
- **描述**: 坚固的铁制护甲
- **类型**: equipment
- **子类型**: armor
- **效果**: defense: 12

### dragon_armor - 龙鳞甲

- **item_id**: dragon_armor
- **名称**: 龙鳞甲
- **描述**: 由龙鳞打造的传说护甲
- **类型**: equipment
- **子类型**: armor
- **效果**: defense: 22, max_hp: 50

## 装备 - 饰品 (Equipment - Accessory)

### lucky_ring - 幸运戒指

- **item_id**: lucky_ring
- **名称**: 幸运戒指
- **描述**: 提升道具掉落概率
- **类型**: equipment
- **子类型**: accessory
- **效果**: drop_rate_boost: 0.1

### warrior_amulet - 勇士护符

- **item_id**: warrior_amulet
- **名称**: 勇士护符
- **描述**: 全面提升少量战斗属性
- **类型**: equipment
- **子类型**: accessory
- **效果**: attack: 3, defense: 3, max_hp: 20

## 材料 (Material)

### leather_scrap - 皮革碎片

- **item_id**: leather_scrap
- **名称**: 皮革碎片
- **描述**: 击杀野兽掉落，可制作皮甲
- **类型**: material

### iron_ore - 铁矿石

- **item_id**: iron_ore
- **名称**: 铁矿石
- **描述**: 击杀哥布林掉落，可锻造铁制装备
- **类型**: material

### wolf_fang - 狼牙

- **item_id**: wolf_fang
- **名称**: 狼牙
- **描述**: 击杀灰狼掉落，可制作饰品
- **类型**: material

### orc_shield_fragment - 兽人盾碎片

- **item_id**: orc_shield_fragment
- **名称**: 兽人盾碎片
- **描述**: 击杀兽人掉落，可强化护甲
- **类型**: material

### dragon_scale - 龙鳞

- **item_id**: dragon_scale
- **名称**: 龙鳞
- **描述**: 击杀幼龙掉落，传说级材料
- **类型**: material

### flame_gem - 火焰宝石

- **item_id**: flame_gem
- **名称**: 火焰宝石
- **描述**: 击杀幼龙稀有掉落，附魔武器用
- **类型**: material

## 礼包 (Gift Pack)

### starter_pack - 新手礼包

- **item_id**: starter_pack
- **名称**: 新手礼包
- **描述**: 包含新手必备物品
- **类型**: gift_pack
- **包含物品**:
  - hp_potion_s (小生命药水) x 5
  - wooden_sword (木剑) x 1
  - cloth_armor (布甲) x 1

### warrior_pack - 战士补给包

- **item_id**: warrior_pack
- **名称**: 战士补给包
- **描述**: 为战斗准备的补给
- **类型**: gift_pack
- **包含物品**:
  - hp_potion_m (中生命药水) x 3
  - atk_potion (力量药剂) x 2
  - def_potion (铁壁药剂) x 2

### treasure_box - 宝藏箱

- **item_id**: treasure_box
- **名称**: 宝藏箱
- **描述**: 打开后随机获得装备或材料
- **类型**: gift_pack
- **随机获得其一**:
  - iron_sword (铁剑)
  - leather_armor (皮甲)
  - lucky_ring (幸运戒指)
  - iron_ore (铁矿石) x 5
