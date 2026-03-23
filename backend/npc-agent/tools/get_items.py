from strands import tool
import logging

from db_config import dynamodb, table_name
from kb_client import query_knowledge_base

logger = logging.getLogger(__name__)


@tool
def get_available_items() -> list | str:
    """获取道具字典中所有道具，包含名称、类型、效果等。

    任务的 conditions 和 awards 中引用的 item_id 必须来自此列表。
    道具类型包括：consumable（消耗品）、equipment（装备）、
    material（材料）、gift_pack（礼包）。

    Returns:
        道具字典全量列表，每条包含 item_id, name, description, type,
        sub_type（装备专用）, effect 等字段。
    """
    # 优先从 Knowledge Base 检索
    kb_results = query_knowledge_base("所有道具 items 全量列表 item_id 类型 效果")
    if kb_results:
        logger.info("Returning items from Knowledge Base (%d chunks)", len(kb_results))
        return "\n\n".join(kb_results)

    # Fallback: DynamoDB Scan
    logger.info("KB unavailable, falling back to DynamoDB scan for items")
    try:
        table = dynamodb.Table(table_name("Items"))
        resp = table.scan()
        items = resp.get("Items", [])

        while "LastEvaluatedKey" in resp:
            resp = table.scan(ExclusiveStartKey=resp["LastEvaluatedKey"])
            items.extend(resp.get("Items", []))

        return items
    except Exception as e:
        logger.error(f"Failed to get items: {e}")
        return {"error": str(e)}
