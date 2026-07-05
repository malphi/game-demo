from strands import tool
import uuid
import logging
from datetime import datetime, timezone

from db_config import dynamodb, table_name
from validation.task_validator import validate_task

logger = logging.getLogger(__name__)

# Per-request guard using mutable dict (avoids global keyword issues with @tool decorator).
# Reset before each agent call via reset_create_task_guard().
_guard = {"created": False}


def reset_create_task_guard():
    """Reset the create_task one-shot guard. Call before each agent invocation."""
    _guard["created"] = False


@tool
def create_task(task_data: dict) -> dict:
    """
    校验并创建任务。每次对话只能调用一次，重复调用会被拒绝。

    校验通过后自动生成 task_id 并写入 Tasks 表。

    Args:
        task_data: 任务数据字典，必须包含以下字段：
            - player_id (str): 玩家 ID
            - npc_id (str): 发布任务的 NPC ID
            - title (str): 任务标题
            - description (str): 任务描述
            - conditions (list): 完成条件列表，每个元素包含：
                - type: 条件类型
                - target_id: 目标 ID
                - required_count: 需要完成的数量
            - awards (list): 奖励列表，每个元素包含：
                - type: "gold" / "exp" / "item"
                - value: 金币或经验数值 (gold/exp 类型)
                - item_id: 道具 ID (item 类型)
                - quantity: 道具数量 (item 类型)

    Returns:
        创建结果字典：
        - 成功: {"success": True, "task_id": "生成的任务ID"}
        - 失败: {"success": False, "reason": ["校验失败原因列表"]}
    """
    # 0. One-shot guard: only allow one task creation per agent invocation
    if _guard["created"]:
        logger.info("create_task blocked: task already created in this invocation")
        return {"success": False, "reason": ["本次对话已创建过任务，不可重复创建"]}

    # 1. 执行任务校验
    validation_result = validate_task(task_data)

    if not validation_result["valid"]:
        logger.warning(
            f"Task validation failed for player {task_data.get('player_id')}: "
            f"{validation_result['reason']}"
        )
        return {
            "success": False,
            "reason": validation_result["reason"],
        }

    # 2. 生成任务 ID 和设置初始状态
    task_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()

    task_item = {
        "task_id": task_id,
        "player_id": task_data["player_id"],
        "npc_id": task_data["npc_id"],
        "title": task_data["title"],
        "description": task_data["description"],
        "status": "pending",
        "conditions": task_data["conditions"],
        "awards": task_data["awards"],
        "created_at": now,
        "completed_at": None,
    }

    # 3. 为每个 condition 初始化 current_count
    for condition in task_item["conditions"]:
        if "current_count" not in condition:
            condition["current_count"] = 0

    # 4. 写入 DynamoDB
    try:
        table = dynamodb.Table(table_name("Tasks"))
        table.put_item(Item=task_item)

        logger.info(
            f"Task created successfully: task_id={task_id}, "
            f"player_id={task_data['player_id']}, "
            f"title={task_data['title']}"
        )

        _guard["created"] = True
        return {
            "success": True,
            "task_id": task_id,
        }

    except Exception as e:
        logger.error(f"Failed to write task to DynamoDB: {e}")
        return {
            "success": False,
            "reason": [f"数据库写入失败: {str(e)}"],
        }
