from strands import tool
import logging

from db_config import dynamodb, table_name

logger = logging.getLogger(__name__)


@tool
def get_available_items() -> list:
    """获取道具字典中所有道具，包含名称、类型、效果等。

    任务的 conditions 和 awards 中引用的 item_id 必须来自此列表。
    道具类型包括：consumable（消耗品）、equipment（装备）、
    material（材料）、gift_pack（礼包）。

    Returns:
        道具字典全量列表，每条包含 item_id, name, description, type,
        sub_type（装备专用）, effect 等字段。
    """
    try:
        table = dynamodb.Table(table_name("Items"))
        resp = table.scan()
        items = resp.get("Items", [])

        # 处理分页
        while "LastEvaluatedKey" in resp:
            resp = table.scan(ExclusiveStartKey=resp["LastEvaluatedKey"])
            items.extend(resp.get("Items", []))

        return items
    except Exception as e:
        logger.error(f"Failed to get items: {e}")
        return {"error": str(e)}
