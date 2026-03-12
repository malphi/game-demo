#!/usr/bin/env python3
"""
Seed script to populate DynamoDB dictionary tables (Monsters, NPCs, Items)
with predefined game data.

Usage:
    # Seed tables in AWS (default region us-west-2)
    python seed_data.py

    # Seed tables with a specific region
    python seed_data.py --region us-east-1

    # Seed tables in local DynamoDB
    python seed_data.py --endpoint-url http://localhost:8000

    # Specify environment suffix for table names
    python seed_data.py --env dev
"""

import argparse
import sys
from decimal import Decimal

import boto3


# =============================================================================
# Dictionary Data
# =============================================================================

MONSTERS = [
    {
        "monster_id": "slime_01",
        "name": "史莱姆",
        "level": 1,
        "hp": 45,
        "attack": 22,
        "defense": 2,
        "exp_reward": 10,
        "gold_reward": 5,
        "drop_items": [
            {"item_id": "leather_armor", "probability": Decimal("1.0")},
            {"item_id": "hp_potion_s", "probability": Decimal("0.5")},
        ],
        "sprite": "monster_slime",
    },
    {
        "monster_id": "goblin_01",
        "name": "哥布林",
        "level": 2,
        "hp": 55,
        "attack": 26,
        "defense": 4,
        "exp_reward": 25,
        "gold_reward": 15,
        "drop_items": [
            {"item_id": "iron_ore", "probability": Decimal("0.4")},
            {"item_id": "hp_potion_s", "probability": Decimal("0.5")},
        ],
        "sprite": "monster_goblin",
    },
    {
        "monster_id": "wolf_01",
        "name": "灰狼",
        "level": 3,
        "hp": 65,
        "attack": 28,
        "defense": 6,
        "exp_reward": 45,
        "gold_reward": 25,
        "drop_items": [
            {"item_id": "wolf_fang", "probability": Decimal("0.5")},
            {"item_id": "leather_scrap", "probability": Decimal("0.6")},
            {"item_id": "hp_potion_s", "probability": Decimal("0.3")},
            {"item_id": "atk_potion", "probability": Decimal("0.2")},
        ],
        "sprite": "monster_wolf",
    },
    {
        "monster_id": "orc_01",
        "name": "兽人战士",
        "level": 4,
        "hp": 75,
        "attack": 32,
        "defense": 8,
        "exp_reward": 80,
        "gold_reward": 50,
        "drop_items": [
            {"item_id": "iron_ore", "probability": Decimal("0.6")},
            {"item_id": "orc_shield_fragment", "probability": Decimal("0.3")},
            {"item_id": "hp_potion_m", "probability": Decimal("0.3")},
            {"item_id": "atk_potion", "probability": Decimal("0.2")},
        ],
        "sprite": "monster_orc",
    },
    {
        "monster_id": "dragon_01",
        "name": "幼龙",
        "level": 5,
        "hp": 90,
        "attack": 30,
        "defense": 10,
        "exp_reward": 150,
        "gold_reward": 100,
        "drop_items": [
            {"item_id": "dragon_scale", "probability": Decimal("0.4")},
            {"item_id": "flame_gem", "probability": Decimal("0.2")},
            {"item_id": "hp_potion_l", "probability": Decimal("0.2")},
        ],
        "sprite": "monster_dragon",
    },
]

NPCS = [
    {
        "npc_id": "npc_elder",
        "name": "村长老莫",
        "role": "村庄长老，负责新手引导和主线任务推进",
        "personality": "慈祥稳重，说话简洁，喜欢用谚语教导年轻人",
        "position_x": 500,
        "position_y": 300,
        "sprite": "npc_elder",
    },
    {
        "npc_id": "npc_blacksmith",
        "name": "铁匠格雷",
        "role": "武器店铁匠，指导玩家装备强化和材料收集",
        "personality": "粗犷豪爽，热情直率，对武器和装备充满热忱",
        "position_x": 350,
        "position_y": 450,
        "sprite": "npc_blacksmith",
    },
    {
        "npc_id": "npc_merchant",
        "name": "商人莉娜",
        "role": "流浪商人，提供道具交易相关任务和情报线索",
        "personality": "精明狡黠，话语间夹带商业推销，但本性善良",
        "position_x": 650,
        "position_y": 400,
        "sprite": "npc_merchant",
    },
    {
        "npc_id": "npc_healer",
        "name": "药师艾琳",
        "role": "教堂药师，引导玩家使用药水和恢复类道具",
        "personality": "温柔细心，关心玩家的健康状态，说话轻声细语",
        "position_x": 480,
        "position_y": 250,
        "sprite": "npc_healer",
    },
]

ITEMS = [
    # ---- Consumables ----
    {
        "item_id": "hp_potion_s",
        "name": "小生命药水",
        "description": "恢复 30 点生命值",
        "type": "consumable",
        "effect": {"hp_restore": 30},
        "sprite": "item_hp_potion_s",
    },
    {
        "item_id": "hp_potion_m",
        "name": "中生命药水",
        "description": "恢复 80 点生命值",
        "type": "consumable",
        "effect": {"hp_restore": 80},
        "sprite": "item_hp_potion_m",
    },
    {
        "item_id": "hp_potion_l",
        "name": "大生命药水",
        "description": "恢复 200 点生命值",
        "type": "consumable",
        "effect": {"hp_restore": 200},
        "sprite": "item_hp_potion_l",
    },
    {
        "item_id": "atk_potion",
        "name": "力量药剂",
        "description": "攻击力临时提升 10，持续 3 场战斗",
        "type": "consumable",
        "effect": {"attack_boost": 10, "duration_battles": 3},
        "sprite": "item_atk_potion",
    },
    {
        "item_id": "def_potion",
        "name": "铁壁药剂",
        "description": "防御力临时提升 10，持续 3 场战斗",
        "type": "consumable",
        "effect": {"defense_boost": 10, "duration_battles": 3},
        "sprite": "item_def_potion",
    },
    # ---- Equipment: Weapons ----
    {
        "item_id": "wooden_sword",
        "name": "木剑",
        "description": "新手武器，聊胜于无",
        "type": "equipment",
        "sub_type": "weapon",
        "effect": {"attack": 3},
        "sprite": "item_wooden_sword",
    },
    {
        "item_id": "iron_sword",
        "name": "铁剑",
        "description": "可靠的铁制长剑",
        "type": "equipment",
        "sub_type": "weapon",
        "effect": {"attack": 8},
        "sprite": "item_iron_sword",
    },
    {
        "item_id": "steel_sword",
        "name": "钢剑",
        "description": "精锻钢制长剑，锋利无比",
        "type": "equipment",
        "sub_type": "weapon",
        "effect": {"attack": 15},
        "sprite": "item_steel_sword",
    },
    {
        "item_id": "flame_blade",
        "name": "烈焰之刃",
        "description": "附着火焰魔力的武器",
        "type": "equipment",
        "sub_type": "weapon",
        "effect": {"attack": 25, "fire_damage": 5},
        "sprite": "item_flame_blade",
    },
    # ---- Equipment: Armor ----
    {
        "item_id": "cloth_armor",
        "name": "布甲",
        "description": "简单的布制衣物",
        "type": "equipment",
        "sub_type": "armor",
        "effect": {"defense": 2},
        "sprite": "item_cloth_armor",
    },
    {
        "item_id": "leather_armor",
        "name": "皮甲",
        "description": "皮革制作的轻便护甲",
        "type": "equipment",
        "sub_type": "armor",
        "effect": {"defense": 5},
        "sprite": "item_leather_armor",
    },
    {
        "item_id": "iron_armor",
        "name": "铁甲",
        "description": "坚固的铁制护甲",
        "type": "equipment",
        "sub_type": "armor",
        "effect": {"defense": 12},
        "sprite": "item_iron_armor",
    },
    {
        "item_id": "dragon_armor",
        "name": "龙鳞甲",
        "description": "由龙鳞打造的传说护甲",
        "type": "equipment",
        "sub_type": "armor",
        "effect": {"defense": 22, "max_hp": 50},
        "sprite": "item_dragon_armor",
    },
    # ---- Equipment: Accessories ----
    {
        "item_id": "lucky_ring",
        "name": "幸运戒指",
        "description": "提升道具掉落概率",
        "type": "equipment",
        "sub_type": "accessory",
        "effect": {"drop_rate_boost": Decimal("0.1")},
        "sprite": "item_lucky_ring",
    },
    {
        "item_id": "warrior_amulet",
        "name": "勇士护符",
        "description": "全面提升少量战斗属性",
        "type": "equipment",
        "sub_type": "accessory",
        "effect": {"attack": 3, "defense": 3, "max_hp": 20},
        "sprite": "item_warrior_amulet",
    },
    # ---- Materials ----
    {
        "item_id": "leather_scrap",
        "name": "皮革碎片",
        "description": "击杀野兽掉落，可制作皮甲",
        "type": "material",
        "effect": {},
        "sprite": "item_leather_scrap",
    },
    {
        "item_id": "iron_ore",
        "name": "铁矿石",
        "description": "击杀哥布林掉落，可锻造铁制装备",
        "type": "material",
        "effect": {},
        "sprite": "item_iron_ore",
    },
    {
        "item_id": "wolf_fang",
        "name": "狼牙",
        "description": "击杀灰狼掉落，可制作饰品",
        "type": "material",
        "effect": {},
        "sprite": "item_wolf_fang",
    },
    {
        "item_id": "orc_shield_fragment",
        "name": "兽人盾碎片",
        "description": "击杀兽人掉落，可强化护甲",
        "type": "material",
        "effect": {},
        "sprite": "item_orc_shield_fragment",
    },
    {
        "item_id": "dragon_scale",
        "name": "龙鳞",
        "description": "击杀幼龙掉落，传说级材料",
        "type": "material",
        "effect": {},
        "sprite": "item_dragon_scale",
    },
    {
        "item_id": "flame_gem",
        "name": "火焰宝石",
        "description": "击杀幼龙稀有掉落，附魔武器用",
        "type": "material",
        "effect": {},
        "sprite": "item_flame_gem",
    },
    # ---- Gift Packs ----
    {
        "item_id": "starter_pack",
        "name": "新手礼包",
        "description": "包含新手必备物品",
        "type": "gift_pack",
        "effect": {
            "contains": [
                {"item_id": "hp_potion_s", "quantity": 5},
                {"item_id": "wooden_sword", "quantity": 1},
                {"item_id": "cloth_armor", "quantity": 1},
            ]
        },
        "sprite": "item_starter_pack",
    },
    {
        "item_id": "warrior_pack",
        "name": "战士补给包",
        "description": "为战斗准备的补给",
        "type": "gift_pack",
        "effect": {
            "contains": [
                {"item_id": "hp_potion_m", "quantity": 3},
                {"item_id": "atk_potion", "quantity": 2},
                {"item_id": "def_potion", "quantity": 2},
            ]
        },
        "sprite": "item_warrior_pack",
    },
    {
        "item_id": "treasure_box",
        "name": "宝藏箱",
        "description": "打开后随机获得装备或材料",
        "type": "gift_pack",
        "effect": {
            "random_one_of": [
                {"item_id": "iron_sword"},
                {"item_id": "leather_armor"},
                {"item_id": "lucky_ring"},
                {"item_id": "iron_ore", "quantity": 5},
            ]
        },
        "sprite": "item_treasure_box",
    },
]


# =============================================================================
# Helper: Convert Python numbers to Decimal for DynamoDB compatibility
# =============================================================================

def convert_to_dynamodb_types(obj):
    """Recursively convert float/int values to Decimal for DynamoDB."""
    if isinstance(obj, float):
        return Decimal(str(obj))
    elif isinstance(obj, int):
        return Decimal(str(obj))
    elif isinstance(obj, dict):
        return {k: convert_to_dynamodb_types(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [convert_to_dynamodb_types(item) for item in obj]
    return obj


# =============================================================================
# Seeding Logic
# =============================================================================

def batch_write_items(dynamodb_resource, table_name, items, pk_field):
    """
    Write items to a DynamoDB table using batch_write_item.
    Uses put requests which will overwrite existing items with the same key.

    DynamoDB batch_write_item supports up to 25 items per batch.
    """
    table = dynamodb_resource.Table(table_name)

    # Convert all items to DynamoDB-compatible types
    converted_items = [convert_to_dynamodb_types(item) for item in items]

    # batch_write_item supports max 25 items per call
    batch_size = 25
    for i in range(0, len(converted_items), batch_size):
        batch = converted_items[i : i + batch_size]
        with table.batch_writer(overwrite_by_pkeys=[pk_field]) as writer:
            for item in batch:
                writer.put_item(Item=item)

    return len(converted_items)


def seed_table(dynamodb_resource, table_name, items, pk_field, label):
    """Seed a single table and print progress."""
    print(f"  Seeding {label} into '{table_name}'...")
    count = batch_write_items(dynamodb_resource, table_name, items, pk_field)
    print(f"  -> {count} {label} written successfully.")
    return count


def main():
    parser = argparse.ArgumentParser(
        description="Seed DynamoDB dictionary tables with game data."
    )
    parser.add_argument(
        "--region",
        default="us-west-2",
        help="AWS region (default: us-west-2)",
    )
    parser.add_argument(
        "--endpoint-url",
        default=None,
        help="DynamoDB endpoint URL (e.g., http://localhost:8000 for local DynamoDB)",
    )
    parser.add_argument(
        "--env",
        default="dev",
        choices=["dev", "staging", "prod"],
        help="Environment suffix for table names (default: dev)",
    )
    args = parser.parse_args()

    # Build DynamoDB resource kwargs
    kwargs = {"region_name": args.region}
    if args.endpoint_url:
        kwargs["endpoint_url"] = args.endpoint_url

    dynamodb = boto3.resource("dynamodb", **kwargs)

    env = args.env
    monsters_table = f"Monsters-{env}"
    npcs_table = f"NPCs-{env}"
    items_table = f"Items-{env}"

    print("=" * 60)
    print("Game Demo - DynamoDB Seed Script")
    print("=" * 60)
    print(f"  Region:       {args.region}")
    print(f"  Endpoint:     {args.endpoint_url or 'AWS default'}")
    print(f"  Environment:  {env}")
    print(f"  Tables:       {monsters_table}, {npcs_table}, {items_table}")
    print("=" * 60)
    print()

    total = 0

    # Seed Monsters
    total += seed_table(
        dynamodb, monsters_table, MONSTERS, "monster_id", "monsters"
    )
    print()

    # Seed NPCs
    total += seed_table(
        dynamodb, npcs_table, NPCS, "npc_id", "NPCs"
    )
    print()

    # Seed Items
    total += seed_table(
        dynamodb, items_table, ITEMS, "item_id", "items"
    )
    print()

    print("=" * 60)
    print(f"Seeding complete! Total records written: {total}")
    print(f"  Monsters: {len(MONSTERS)}")
    print(f"  NPCs:     {len(NPCS)}")
    print(f"  Items:    {len(ITEMS)}")
    print("=" * 60)


if __name__ == "__main__":
    main()
