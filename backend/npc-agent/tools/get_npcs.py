from strands import tool
import logging

from db_config import dynamodb, table_name
from kb_client import query_knowledge_base

logger = logging.getLogger(__name__)


@tool
def get_available_npcs() -> list | str:
    """获取 NPC 字典中所有 NPC，包含 npc_id、名称、角色。

    talk_to_npc 类型条件引用的 npc_id 必须来自此列表。
    任务的 npc_id（发布者）也必须是此列表中存在的 NPC。

    当前游戏中的 NPC 包括：
    - npc_elder（村长老莫）: 村庄长老，新手引导
    - npc_blacksmith（铁匠格雷）: 武器店铁匠，装备强化
    - npc_merchant（商人莉娜）: 流浪商人，道具交易
    - npc_healer（药师艾琳）: 教堂药师，药水恢复

    Returns:
        NPC 字典全量列表，每条包含 npc_id, name, role, personality,
        position_x, position_y 等字段。
    """
    # 优先从 Knowledge Base 检索
    kb_results = query_knowledge_base("所有NPC全量列表 npc_id 名称 角色 性格")
    if kb_results:
        logger.info("Returning NPCs from Knowledge Base (%d chunks)", len(kb_results))
        return "\n\n".join(kb_results)

    # Fallback: DynamoDB Scan
    logger.info("KB unavailable, falling back to DynamoDB scan for NPCs")
    try:
        table = dynamodb.Table(table_name("NPCs"))
        resp = table.scan()
        items = resp.get("Items", [])

        while "LastEvaluatedKey" in resp:
            resp = table.scan(ExclusiveStartKey=resp["LastEvaluatedKey"])
            items.extend(resp.get("Items", []))

        return items
    except Exception as e:
        logger.error(f"Failed to get NPCs: {e}")
        return {"error": str(e)}
