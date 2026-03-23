"""
AgentCore Memory 配置模块。

封装 Memory Session Manager 的创建逻辑，供 agent.py 调用。
"""

import logging
import os

logger = logging.getLogger(__name__)

AGENTCORE_MEMORY_ID = os.environ.get("AGENTCORE_MEMORY_ID", "")
BEDROCK_REGION = os.environ.get("BEDROCK_REGION", "us-west-2")


def create_session_manager(player_id: str, npc_id: str):
    """创建 AgentCore Memory Session Manager。

    Args:
        player_id: 玩家 ID，作为 actor_id 隔离不同玩家的记忆
        npc_id: NPC ID，与 player_id 组合为 session_id 隔离不同对话

    Returns:
        AgentCoreMemorySessionManager 实例，如果 memory 未配置则返回 None
    """
    if not AGENTCORE_MEMORY_ID:
        logger.info("AGENTCORE_MEMORY_ID not set, running without memory")
        return None

    try:
        from bedrock_agentcore.memory.integrations.strands.config import (
            AgentCoreMemoryConfig,
        )
        from bedrock_agentcore.memory.integrations.strands.session_manager import (
            AgentCoreMemorySessionManager,
        )

        config = AgentCoreMemoryConfig(
            memory_id=AGENTCORE_MEMORY_ID,
            actor_id=player_id,
            session_id=f"{player_id}_{npc_id}",
        )

        session_manager = AgentCoreMemorySessionManager(
            agentcore_memory_config=config,
            region_name=BEDROCK_REGION,
        )

        logger.info(
            "Memory session created: actor=%s, session=%s_%s",
            player_id,
            player_id,
            npc_id,
        )
        return session_manager

    except Exception as e:
        logger.warning("Failed to create memory session manager: %s", e)
        return None
