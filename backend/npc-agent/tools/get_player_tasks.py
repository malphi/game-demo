from strands import tool
import logging

from db_config import dynamodb, table_name

logger = logging.getLogger(__name__)


@tool
def get_player_tasks(player_id: str) -> list:
    """获取玩家当前进行中和已完成的任务列表，避免生成重复任务。

    通过 Tasks 表的 GSI（player_id-index）查询该玩家的所有任务。
    返回结果包含 pending（待接取）、in_progress（进行中）和
    completed（已完成）状态的任务。

    生成新任务时，应避免与 pending 或 in_progress 状态的任务有相同的
    conditions 组合。

    Args:
        player_id: 玩家唯一标识符

    Returns:
        玩家任务列表，每条包含 task_id, npc_id, title, description,
        status, conditions, awards 等字段。
    """
    try:
        table = dynamodb.Table(table_name("Tasks"))
        resp = table.query(
            IndexName="player_id-index",
            KeyConditionExpression="player_id = :pid",
            ExpressionAttributeValues={":pid": player_id},
        )
        items = resp.get("Items", [])

        # 处理分页
        while "LastEvaluatedKey" in resp:
            resp = table.query(
                IndexName="player_id-index",
                KeyConditionExpression="player_id = :pid",
                ExpressionAttributeValues={":pid": player_id},
                ExclusiveStartKey=resp["LastEvaluatedKey"],
            )
            items.extend(resp.get("Items", []))

        return items
    except Exception as e:
        logger.error(f"Failed to get player tasks for {player_id}: {e}")
        return {"error": str(e)}
