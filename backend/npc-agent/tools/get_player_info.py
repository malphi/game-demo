from strands import tool
import logging

from db_config import dynamodb, table_name

logger = logging.getLogger(__name__)


@tool
def get_player_info(player_id: str) -> dict:
    """获取玩家当前状态，包括等级、属性、背包道具、已完成任务等。

    Args:
        player_id: 玩家唯一标识符

    Returns:
        玩家完整数据，包含 level, exp, gold, hp, max_hp, attack, defense,
        inventory, active_tasks, completed_tasks 等字段。
        如果玩家不存在则返回空字典。
    """
    try:
        table = dynamodb.Table(table_name("Players"))
        resp = table.get_item(Key={"player_id": player_id})
        return resp.get("Item", {})
    except Exception as e:
        logger.error(f"Failed to get player info for {player_id}: {e}")
        return {"error": str(e)}
