from strands import tool
import logging

from validation.task_validator import validate_task as _validate_task

logger = logging.getLogger(__name__)


@tool
def validate_task(task_data: dict) -> dict:
    """仅校验任务数据的合法性，不创建任务。用于在调用 create_task 前预检查。

    校验内容包括：
    - 结构完整性：title, description, conditions, awards 必须存在且非空
    - npc_id 必须在 NPCs 字典表中存在
    - conditions 中的 type 必须是 kill_monster / collect_item / talk_to_npc / use_item
    - conditions 中的 target_id 必须在对应的字典表中真实存在
    - awards 中 type=item 时 item_id 必须在 Items 表中存在
    - 数值范围：金币 1-1000, 经验 1-500, 数量 1-99, required_count 1-99
    - 不能与玩家进行中的任务有相同的 conditions 组合

    Args:
        task_data: 任务数据字典，必须包含以下字段：
            - player_id (str): 玩家 ID
            - npc_id (str): 发布任务的 NPC ID
            - title (str): 任务标题
            - description (str): 任务描述
            - conditions (list): 完成条件列表
            - awards (list): 奖励列表

    Returns:
        校验结果字典：
        - 通过: {"valid": True}
        - 失败: {"valid": False, "reason": ["校验失败原因列表"]}
    """
    return _validate_task(task_data)
