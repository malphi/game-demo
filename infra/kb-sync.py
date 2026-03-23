#!/usr/bin/env python3
"""
KB Data Sync Script - 从 seed_data.py 自动生成 Knowledge Base 数据源 Markdown 文件。

Usage:
    python kb-sync.py
    python kb-sync.py --output-dir ../backend/npc-agent/kb-data
"""

import argparse
import os
import sys

# 将 infra/ 目录加入 path 以导入 seed_data
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from seed_data import MONSTERS, NPCS, ITEMS


def generate_monsters_md(monsters: list) -> str:
    lines = [
        "# 怪物字典 (Monsters)",
        "",
        "游戏\"勇者大陆\"中所有可用怪物的完整列表。任务 conditions 中 kill_monster 类型的 target_id 必须来自此列表中的 monster_id。",
        "",
    ]
    for m in monsters:
        drops = "\n".join(
            f"  - {d['item_id']} - 掉落概率 {int(float(str(d['probability'])) * 100)}%"
            for d in m.get("drop_items", [])
        )
        lines.extend([
            f"## {m['monster_id']} - {m['name']}",
            "",
            f"- **monster_id**: {m['monster_id']}",
            f"- **名称**: {m['name']}",
            f"- **等级**: {m['level']}",
            f"- **生命值 (HP)**: {m['hp']}",
            f"- **攻击力**: {m['attack']}",
            f"- **防御力**: {m['defense']}",
            f"- **经验奖励**: {m['exp_reward']}",
            f"- **金币奖励**: {m['gold_reward']}",
            f"- **掉落物品**:",
            drops,
            f"- **精灵图**: {m['sprite']}",
            "",
        ])
    return "\n".join(lines)


def generate_items_md(items: list) -> str:
    categories = {
        "consumable": ("消耗品 (Consumable)", []),
        "equipment_weapon": ("装备 - 武器 (Equipment - Weapon)", []),
        "equipment_armor": ("装备 - 护甲 (Equipment - Armor)", []),
        "equipment_accessory": ("装备 - 饰品 (Equipment - Accessory)", []),
        "material": ("材料 (Material)", []),
        "gift_pack": ("礼包 (Gift Pack)", []),
    }
    for item in items:
        t = item["type"]
        if t == "equipment":
            key = f"equipment_{item.get('sub_type', 'weapon')}"
        else:
            key = t
        if key in categories:
            categories[key][1].append(item)

    lines = [
        "# 道具字典 (Items)",
        "",
        "游戏\"勇者大陆\"中所有可用道具的完整列表。任务的 conditions 和 awards 中引用的 item_id 必须来自此列表。",
        "",
    ]
    for key, (title, cat_items) in categories.items():
        if not cat_items:
            continue
        lines.extend([f"## {title}", ""])
        for item in cat_items:
            lines.extend([
                f"### {item['item_id']} - {item['name']}",
                "",
                f"- **item_id**: {item['item_id']}",
                f"- **名称**: {item['name']}",
                f"- **描述**: {item.get('description', '')}",
                f"- **类型**: {item['type']}",
            ])
            if item.get("sub_type"):
                lines.append(f"- **子类型**: {item['sub_type']}")
            effect = item.get("effect", {})
            if "contains" in effect:
                lines.append("- **包含物品**:")
                for c in effect["contains"]:
                    lines.append(f"  - {c['item_id']} x {c.get('quantity', 1)}")
            elif "random_one_of" in effect:
                lines.append("- **随机获得其一**:")
                for r in effect["random_one_of"]:
                    qty = f" x {r['quantity']}" if r.get("quantity") else ""
                    lines.append(f"  - {r['item_id']}{qty}")
            elif effect:
                effect_str = ", ".join(f"{k}: {v}" for k, v in effect.items())
                lines.append(f"- **效果**: {effect_str}")
            lines.append("")
    return "\n".join(lines)


def generate_npcs_md(npcs: list) -> str:
    task_types = {
        "npc_elder": "kill_monster（打怪任务）",
        "npc_blacksmith": "collect_item（道具收集任务，收集材料、装备等）",
        "npc_merchant": "use_item（使用道具任务，引导玩家使用背包中的装备或道具）",
        "npc_healer": "use_item（使用药水/恢复类任务）",
    }
    lines = [
        "# NPC 字典 (NPCs)",
        "",
        "游戏\"勇者大陆\"中所有 NPC 的完整列表。talk_to_npc 类型条件引用的 npc_id 必须来自此列表。任务的 npc_id（发布者）也必须是此列表中存在的 NPC。",
        "",
    ]
    for npc in npcs:
        lines.extend([
            f"## {npc['npc_id']} - {npc['name']}",
            "",
            f"- **npc_id**: {npc['npc_id']}",
            f"- **名称**: {npc['name']}",
            f"- **角色**: {npc['role']}",
            f"- **性格**: {npc['personality']}",
            f"- **位置**: x={npc['position_x']}, y={npc['position_y']}",
            f"- **可发布任务类型**: {task_types.get(npc['npc_id'], '未知')}",
            f"- **精灵图**: {npc['sprite']}",
            "",
        ])
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(
        description="Generate KB data source Markdown files from seed_data.py"
    )
    parser.add_argument(
        "--output-dir",
        default=os.path.join(
            os.path.dirname(os.path.abspath(__file__)),
            "..", "backend", "npc-agent", "kb-data",
        ),
        help="Output directory for KB data files (default: backend/npc-agent/kb-data)",
    )
    args = parser.parse_args()

    output_dir = os.path.abspath(args.output_dir)
    os.makedirs(output_dir, exist_ok=True)

    files = {
        "monsters.md": generate_monsters_md(MONSTERS),
        "items.md": generate_items_md(ITEMS),
        "npcs.md": generate_npcs_md(NPCS),
    }

    print(f"Generating KB data files to: {output_dir}")
    for filename, content in files.items():
        filepath = os.path.join(output_dir, filename)
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(content)
        print(f"  -> {filename} written")

    # task_rules.md is hand-maintained, skip if it already exists
    task_rules_path = os.path.join(output_dir, "task_rules.md")
    if os.path.exists(task_rules_path):
        print(f"  -> task_rules.md already exists, skipping (hand-maintained)")
    else:
        print(f"  [!] task_rules.md not found - please create it manually")

    print(f"\nDone! {len(files)} files generated.")


if __name__ == "__main__":
    main()
