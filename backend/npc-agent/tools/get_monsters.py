from strands import tool
import logging

from db_config import dynamodb, table_name
from kb_client import query_knowledge_base

logger = logging.getLogger(__name__)


@tool
def get_available_monsters() -> list | str:
    """获取游戏中所有可用的怪物模板，包含名称、等级、属性等。

    任务 conditions 中 kill_monster 类型的 target_id 必须来自此列表中的 monster_id。
    怪物按等级从低到高排列：
    - slime_01（史莱姆, level=1）
    - goblin_01（哥布林, level=2）
    - wolf_01（灰狼, level=3）
    - orc_01（兽人战士, level=4）
    - dragon_01（幼龙, level=5）

    Returns:
        怪物字典全量列表，每条包含 monster_id, name, level, hp, attack,
        defense, exp_reward, gold_reward, drop_items 等字段。
    """
    # 优先从 Knowledge Base 检索
    kb_results = query_knowledge_base("所有怪物 monsters 全量列表 monster_id 等级 属性")
    if kb_results:
        logger.info("Returning monsters from Knowledge Base (%d chunks)", len(kb_results))
        return "\n\n".join(kb_results)

    # Fallback: DynamoDB Scan
    logger.info("KB unavailable, falling back to DynamoDB scan for monsters")
    try:
        table = dynamodb.Table(table_name("Monsters"))
        resp = table.scan()
        items = resp.get("Items", [])

        while "LastEvaluatedKey" in resp:
            resp = table.scan(ExclusiveStartKey=resp["LastEvaluatedKey"])
            items.extend(resp.get("Items", []))

        return items
    except Exception as e:
        logger.error(f"Failed to get monsters: {e}")
        return {"error": str(e)}
