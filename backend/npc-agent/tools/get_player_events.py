from strands import tool
import logging

from db_config import dynamodb, table_name

logger = logging.getLogger(__name__)


@tool
def get_player_events(player_id: str, limit: int = 20) -> list:
    """获取玩家最近的行为日志，用于分析玩家当前处境和游戏进度。

    行为日志来自 PlayerEventSummary 表，按时间倒序排列（最新事件在前）。
    事件类型包括：battle_victory（战斗胜利）、battle_defeat（战斗失败）、
    task_completed（任务完成）、item_acquired（获得道具）、
    item_used（使用道具）、level_up（玩家升级）。

    Args:
        player_id: 玩家唯一标识符
        limit: 返回的最大事件数量，默认 20 条

    Returns:
        最近 N 条行为日志列表，每条包含 event_type, target_id, result,
        details, timestamp 等字段。
    """
    try:
        table = dynamodb.Table(table_name("PlayerEventSummary"))
        resp = table.query(
            KeyConditionExpression="player_id = :pid",
            ExpressionAttributeValues={":pid": player_id},
            ScanIndexForward=False,  # 倒序，最新的在前
            Limit=limit,
        )
        return resp.get("Items", [])
    except Exception as e:
        logger.error(f"Failed to get player events for {player_id}: {e}")
        return {"error": str(e)}
