"""
任务校验模块。

AI 生成的任务在写入数据库前，必须通过此模块的校验逻辑，确保任务可执行、数据合法。

校验规则：
1. 结构完整性：title, description, conditions, awards 字段必须存在且非空
2. npc_id 校验：任务发布者必须在 NPCs 字典表中存在
3. 条件类型合法：type 必须是 kill_monster / collect_item / talk_to_npc / use_item 之一
4. target_id 存在性：kill_monster→Monsters表, collect_item/use_item→Items表, talk_to_npc→NPCs表
5. 奖励 item_id 存在性：type=item 时 item_id 必须在 Items 表中存在
6. 数值范围：金币 1-1000, 经验 1-500, 道具数量 1-99, required_count 1-99
7. 任务去重：不能与玩家 active tasks 有相同的 conditions 组合
"""

import logging

from db_config import dynamodb, table_name

logger = logging.getLogger(__name__)

# 合法的条件类型
VALID_CONDITION_TYPES = {"kill_monster", "collect_item", "talk_to_npc", "use_item"}

# 条件类型 -> DynamoDB 表名映射
TARGET_TABLE_MAP = {
    "kill_monster": "Monsters",
    "collect_item": "Items",
    "use_item": "Items",
    "talk_to_npc": "NPCs",
}

# DynamoDB 表名 -> 主键名映射
TARGET_ID_KEY_MAP = {
    "Monsters": "monster_id",
    "Items": "item_id",
    "NPCs": "npc_id",
}

# 数值范围限制
VALUE_LIMITS = {
    "gold": {"min": 1, "max": 1000},
    "exp": {"min": 1, "max": 500},
}
QUANTITY_MIN = 1
QUANTITY_MAX = 99
REQUIRED_COUNT_MIN = 1
REQUIRED_COUNT_MAX = 99


def _check_exists_in_table(base_table_name: str, key_name: str, key_value: str) -> bool:
    """检查指定记录是否存在于 DynamoDB 表中。"""
    try:
        table = dynamodb.Table(table_name(base_table_name))
        resp = table.get_item(Key={key_name: key_value})
        return "Item" in resp
    except Exception as e:
        logger.error(f"Failed to check existence in {table_name}: {e}")
        return False


def _normalize_conditions(conditions: list) -> list:
    """将 conditions 标准化为可比较的元组列表，用于去重判断。"""
    normalized = []
    for cond in conditions:
        normalized.append((
            cond.get("type", ""),
            cond.get("target_id", ""),
        ))
    return sorted(normalized)


def validate_task(task_data: dict) -> dict:
    """
    校验任务数据的合法性。

    Args:
        task_data: 任务数据字典，应包含 player_id, npc_id, title,
                   description, conditions, awards 等字段。

    Returns:
        校验结果字典：
        - 通过: {"valid": True}
        - 失败: {"valid": False, "reason": [...错误列表]}
    """
    errors = []

    # ========== 1. 结构完整性校验 ==========
    required_fields = ["title", "description", "conditions", "awards"]
    for field in required_fields:
        if field not in task_data:
            errors.append(f"缺少必要字段: {field}")
        elif not task_data[field]:
            errors.append(f"字段不能为空: {field}")

    # 如果基础结构都不完整，提前返回
    if errors:
        return {"valid": False, "reason": errors}

    # ========== 2. npc_id 校验（任务发布者必须在 NPC 字典表中） ==========
    if "npc_id" not in task_data or not task_data["npc_id"]:
        errors.append("缺少必要字段: npc_id")
    else:
        if not _check_exists_in_table("NPCs", "npc_id", task_data["npc_id"]):
            errors.append(f"npc_id 不存在于 NPC 字典表: {task_data['npc_id']}")

    # ========== 3. 条件校验 ==========
    conditions = task_data.get("conditions", [])

    if not isinstance(conditions, list):
        errors.append("conditions 必须是列表类型")
    else:
        for i, cond in enumerate(conditions):
            if not isinstance(cond, dict):
                errors.append(f"conditions[{i}] 必须是字典类型")
                continue

            # 3a. 条件类型合法性
            cond_type = cond.get("type")
            if cond_type not in VALID_CONDITION_TYPES:
                errors.append(
                    f"不支持的条件类型: {cond_type}（支持的类型: "
                    f"{', '.join(sorted(VALID_CONDITION_TYPES))}）"
                )
                continue

            # 3b. target_id 存在性校验
            target_id = cond.get("target_id")
            if not target_id:
                errors.append(f"conditions[{i}] 缺少 target_id")
            else:
                target_table = TARGET_TABLE_MAP[cond_type]
                pk_name = TARGET_ID_KEY_MAP[target_table]
                if not _check_exists_in_table(target_table, pk_name, target_id):
                    errors.append(
                        f"target_id 不存在: {target_id}（表: {target_table}）"
                    )

            # 3c. required_count 范围校验
            required_count = cond.get("required_count")
            if required_count is None:
                errors.append(f"conditions[{i}] 缺少 required_count")
            elif not isinstance(required_count, (int, float)):
                errors.append(
                    f"conditions[{i}] required_count 必须是数字类型，"
                    f"当前值: {required_count}"
                )
            elif not (REQUIRED_COUNT_MIN <= int(required_count) <= REQUIRED_COUNT_MAX):
                errors.append(
                    f"required_count 超出范围: {required_count}"
                    f"（允许范围: {REQUIRED_COUNT_MIN}-{REQUIRED_COUNT_MAX}）"
                )

    # ========== 4. 奖励校验 ==========
    awards = task_data.get("awards", [])

    if not isinstance(awards, list):
        errors.append("awards 必须是列表类型")
    else:
        for i, award in enumerate(awards):
            if not isinstance(award, dict):
                errors.append(f"awards[{i}] 必须是字典类型")
                continue

            award_type = award.get("type")

            if award_type == "item":
                # 4a. 道具奖励：item_id 必须存在
                item_id = award.get("item_id")
                if not item_id:
                    errors.append(f"awards[{i}] type=item 但缺少 item_id")
                else:
                    if not _check_exists_in_table("Items", "item_id", item_id):
                        errors.append(f"奖励 item_id 不存在: {item_id}")

                # 4b. 道具数量范围校验
                quantity = award.get("quantity")
                if quantity is None:
                    errors.append(f"awards[{i}] type=item 但缺少 quantity")
                elif not isinstance(quantity, (int, float)):
                    errors.append(
                        f"awards[{i}] quantity 必须是数字类型，当前值: {quantity}"
                    )
                elif not (QUANTITY_MIN <= int(quantity) <= QUANTITY_MAX):
                    errors.append(
                        f"道具数量超出范围: {quantity}"
                        f"（允许范围: {QUANTITY_MIN}-{QUANTITY_MAX}）"
                    )

            elif award_type in ("gold", "exp"):
                # 4c. 金币/经验数值范围校验
                value = award.get("value")
                limits = VALUE_LIMITS[award_type]
                if value is None:
                    errors.append(
                        f"awards[{i}] type={award_type} 但缺少 value"
                    )
                elif not isinstance(value, (int, float)):
                    errors.append(
                        f"awards[{i}] value 必须是数字类型，当前值: {value}"
                    )
                elif not (limits["min"] <= int(value) <= limits["max"]):
                    errors.append(
                        f"{award_type} 数值超出范围: {value}"
                        f"（允许范围: {limits['min']}-{limits['max']}）"
                    )

            else:
                errors.append(
                    f"awards[{i}] 不支持的奖励类型: {award_type}"
                    f"（支持的类型: gold, exp, item）"
                )

    # ========== 5. 任务去重校验 ==========
    player_id = task_data.get("player_id")
    if player_id and isinstance(conditions, list) and len(conditions) > 0:
        try:
            tasks_table = dynamodb.Table(table_name("Tasks"))
            resp = tasks_table.query(
                IndexName="player_id-index",
                KeyConditionExpression="player_id = :pid",
                ExpressionAttributeValues={":pid": player_id},
            )
            existing_tasks = resp.get("Items", [])

            # 处理分页
            while "LastEvaluatedKey" in resp:
                resp = tasks_table.query(
                    IndexName="player_id-index",
                    KeyConditionExpression="player_id = :pid",
                    ExpressionAttributeValues={":pid": player_id},
                    ExclusiveStartKey=resp["LastEvaluatedKey"],
                )
                existing_tasks.extend(resp.get("Items", []))

            # 新任务的标准化条件
            new_conditions_normalized = _normalize_conditions(conditions)

            # 检查与 active（pending / in_progress）任务的重复
            for existing_task in existing_tasks:
                if existing_task.get("status") in ("pending", "in_progress", "completed"):
                    existing_conditions = existing_task.get("conditions", [])
                    existing_normalized = _normalize_conditions(existing_conditions)

                    if new_conditions_normalized == existing_normalized:
                        errors.append(
                            f"任务目标与进行中任务重复"
                            f"（冲突任务ID: {existing_task.get('task_id', 'unknown')}）"
                        )
                        break  # 找到一个重复即可

        except Exception as e:
            logger.error(f"Failed to check task dedup for player {player_id}: {e}")
            # 去重检查失败不阻塞任务创建，但记录警告
            logger.warning("Task dedup check failed, proceeding without dedup validation")

    # ========== 返回结果 ==========
    if errors:
        return {"valid": False, "reason": errors}

    return {"valid": True}
