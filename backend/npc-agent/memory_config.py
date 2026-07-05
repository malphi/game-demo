"""
AgentCore Memory 配置模块。

封装 Memory Session Manager 的创建逻辑，以及事件写入/读取接口，供 agent.py 调用。
"""

import json
import logging
import os
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

def _get_memory_id():
    return os.environ.get("AGENTCORE_MEMORY_ID", "")

def _get_bedrock_region():
    return os.environ.get("BEDROCK_REGION", "us-west-2")

# 事件专用 session，所有 NPC 共享同一个 session 以便任意 NPC 读取最近事件
_EVENT_SESSION_ID = "player_events"

# Module-level MemoryClient singleton (lazy init)
_memory_client = None


def _get_memory_client():
    """获取 MemoryClient 单例。"""
    global _memory_client
    if _memory_client is not None:
        return _memory_client
    if not _get_memory_id():
        return None
    try:
        from bedrock_agentcore.memory import MemoryClient
        _memory_client = MemoryClient(region_name=_get_bedrock_region())
        return _memory_client
    except Exception as e:
        logger.warning("Failed to create MemoryClient: %s", e)
        return None


def create_session_manager(player_id: str, npc_id: str):
    """创建 AgentCore Memory Session Manager。

    Args:
        player_id: 玩家 ID，作为 actor_id 隔离不同玩家的记忆
        npc_id: NPC ID，与 player_id 组合为 session_id 隔离不同对话

    Returns:
        AgentCoreMemorySessionManager 实例，如果 memory 未配置则返回 None
    """
    if not _get_memory_id():
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
            memory_id=_get_memory_id(),
            actor_id=player_id,
            session_id=f"{player_id}_{npc_id}",
        )

        session_manager = AgentCoreMemorySessionManager(
            agentcore_memory_config=config,
            region_name=_get_bedrock_region(),
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


def save_event_to_memory(player_id: str, event_type: str, event_desc: str,
                         target_name: str = ""):
    """将玩家事件写入 Memory（短期记忆），供寒暄语读取。

    Args:
        player_id: 玩家 ID
        event_type: 事件类型（battle_victory, level_up 等）
        event_desc: 事件的中文描述
        target_name: 事件目标名称（怪物名、道具名等），用于寒暄模板 {target} 填充
    """
    client = _get_memory_client()
    if not client:
        return

    try:
        payload = json.dumps(
            {"event_type": event_type, "description": event_desc,
             "target_name": target_name},
            ensure_ascii=False,
        )
        client.create_event(
            memory_id=_get_memory_id(),
            actor_id=player_id,
            session_id=_EVENT_SESSION_ID,
            messages=[(payload, "USER")],
            event_timestamp=datetime.now(timezone.utc),
        )
        logger.info("Event saved to memory: player=%s, type=%s", player_id, event_type)
    except Exception as e:
        logger.warning("Failed to save event to memory: %s", e)


def get_recent_event_from_memory(player_id: str) -> dict | None:
    """从 Memory 读取玩家最近一条事件。

    Returns:
        {"event_type": str, "description": str} 或 None
    """
    client = _get_memory_client()
    if not client:
        return None

    try:
        turns = client.get_last_k_turns(
            memory_id=_get_memory_id(),
            actor_id=player_id,
            session_id=_EVENT_SESSION_ID,
            k=1,
        )
        if not turns:
            return None

        # turns 是 list of turns，每个 turn 是 list of messages
        last_turn = turns[-1]
        for msg in last_turn:
            payload = msg.get("payload", {})
            # payload.messages 是列表，取第一条 USER 消息
            messages = payload.get("messages", [])
            for m in messages:
                if m.get("role") == "USER":
                    text = m.get("content", "")
                    try:
                        return json.loads(text)
                    except (json.JSONDecodeError, TypeError):
                        return {"event_type": "unknown", "description": text}
        return None
    except Exception as e:
        logger.warning("Failed to get event from memory: %s", e)
        return None
