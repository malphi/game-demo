from strands import tool
import logging

from db_config import dynamodb, table_name

logger = logging.getLogger(__name__)


@tool
def get_available_npcs() -> list:
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
    try:
        table = dynamodb.Table(table_name("NPCs"))
        resp = table.scan()
        items = resp.get("Items", [])

        # 处理分页
        while "LastEvaluatedKey" in resp:
            resp = table.scan(ExclusiveStartKey=resp["LastEvaluatedKey"])
            items.extend(resp.get("Items", []))

        return items
    except Exception as e:
        logger.error(f"Failed to get NPCs: {e}")
        return {"error": str(e)}
