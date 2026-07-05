"""
NPC AI Agent 主入口模块。

基于 Strands Agent SDK + Amazon Bedrock 驱动，使用 Tool Use 模式，
LLM 自主决定调用哪些工具（查询玩家、查询字典、创建任务等）。
集成 AgentCore Memory 实现有状态 NPC 对话。

Usage:
    python agent.py
    # 服务启动后访问 POST http://localhost:8090/agent/dialogue
"""

import os
import json
import logging
import time
import decimal
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import uvicorn

from strands import Agent
from strands.models.bedrock import BedrockModel
from strands.handlers import null_callback_handler

from memory_config import create_session_manager, save_event_to_memory, get_recent_event_from_memory
from db_config import dynamodb, table_name
from kb_client import reset_call_log, get_call_log

# ---- Logging setup ----
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

# ---- Load system prompt template ----
PROMPT_DIR = Path(__file__).parent / "prompts"
SYSTEM_PROMPT_TEMPLATE = (PROMPT_DIR / "npc_system_prompt.txt").read_text(encoding="utf-8")

# ---- Bedrock model configuration ----
BEDROCK_MODEL_ID = os.environ.get(
    "BEDROCK_MODEL_ID", "us.anthropic.claude-haiku-4-5-20251001-v1:0"
)
BEDROCK_REGION = os.environ.get("BEDROCK_REGION", "us-west-2")

# ---- Module-level BedrockModel (connection warmup + prompt caching) ----
_is_anthropic = "anthropic" in BEDROCK_MODEL_ID
_model_kwargs = dict(
    model_id=BEDROCK_MODEL_ID,
    region_name=BEDROCK_REGION,
    max_tokens=1024,
    temperature=0.7,
)
if _is_anthropic:
    _model_kwargs["cache_prompt"] = "default"
    _model_kwargs["cache_tools"] = "default"
_bedrock_model = BedrockModel(**_model_kwargs)
logger.info("BedrockModel pre-warmed: model=%s, region=%s, prompt_caching=%s",
            BEDROCK_MODEL_ID, BEDROCK_REGION, _is_anthropic)

def create_npc_agent(system_prompt: str, session_manager=None) -> Agent:
    """Create a Strands Agent instance (no tools — task created by code, LLM only generates dialogue)."""
    kwargs = dict(
        model=_bedrock_model,
        system_prompt=system_prompt,
        callback_handler=null_callback_handler,
    )
    if session_manager is not None:
        kwargs["session_manager"] = session_manager

    agent = Agent(**kwargs)
    return agent


def _create_task_by_code(player_id: str, npc_id: str, game_data: dict) -> dict | None:
    """根据玩家等级从字典表选目标，直接创建任务（不依赖 LLM）。

    Returns:
        创建的 task dict，或 None（如果无法创建）
    """
    import uuid as _uuid
    from datetime import datetime as _dt, timezone as _tz

    player_info = game_data.get("player_info", {})
    player_level = int(player_info.get("level", 1))
    existing_tasks = game_data.get("tasks", [])
    monsters = game_data.get("monsters", [])
    items = game_data.get("items", [])

    if isinstance(monsters, str) or isinstance(items, str):
        # KB string format — shouldn't happen now, but guard
        return None

    # 已有 active 任务的 target_id 集合（含 completed，避免重复）
    used_targets = set()
    has_active_from_npc = False
    for t in existing_tasks:
        if t.get("npc_id") == npc_id and t.get("status") in ("pending", "in_progress"):
            has_active_from_npc = True
        for c in t.get("conditions", []):
            used_targets.add(c.get("target_id"))

    if has_active_from_npc:
        return None  # 已有该 NPC 的活跃任务

    # NPC 类型决定任务类型
    NPC_TASK_CONFIG = {
        "npc_elder": {"type": "kill_monster", "table": "monsters"},
        "npc_scout": {"type": "kill_monster", "table": "monsters"},
        "npc_healer": {"type": "use_item", "table": "items", "filter": "consumable"},
        "npc_blacksmith": {"type": "collect_item", "table": "items", "filter": "material"},
        "npc_merchant": {"type": "use_item", "table": "items", "filter": "consumable"},
    }
    config = NPC_TASK_CONFIG.get(npc_id, {"type": "kill_monster", "table": "monsters"})

    target = None
    task_title = ""
    task_desc = ""
    condition_type = config["type"]

    if config["table"] == "monsters":
        # 选与玩家等级匹配的、未使用过的怪物
        candidates = [m for m in monsters
                      if int(m.get("level", 0)) == player_level
                      and m.get("monster_id") not in used_targets]
        if not candidates:
            # 放宽：选等级 <= 玩家等级的
            candidates = [m for m in monsters
                          if int(m.get("level", 0)) <= player_level
                          and m.get("monster_id") not in used_targets]
        if not candidates:
            # 最后兜底：任意未用过的
            candidates = [m for m in monsters if m.get("monster_id") not in used_targets]
        if candidates:
            target = candidates[0]
            target_id = target["monster_id"]
            target_name = target.get("name", target_id)
            task_title = f"击杀{target_name}"
            task_desc = f"前往野外击杀{target_name}"
    else:
        # 选道具
        filter_type = config.get("filter", "")
        candidates = [i for i in items
                      if i.get("type") == filter_type
                      and i.get("item_id") not in used_targets]
        if candidates:
            target = candidates[0]
            target_id = target["item_id"]
            target_name = target.get("name", target_id)
            if condition_type == "use_item":
                task_title = f"使用{target_name}"
                task_desc = f"使用一个{target_name}"
            else:
                task_title = f"收集{target_name}"
                task_desc = f"收集{target_name}"

    if not target:
        return None

    # 构建任务
    task_id = str(_uuid.uuid4())
    now = _dt.now(_tz.utc).isoformat()
    exp_reward = max(10, player_level * 20)
    gold_reward = max(5, player_level * 10)

    task_item = {
        "task_id": task_id,
        "player_id": player_id,
        "npc_id": npc_id,
        "title": task_title,
        "description": task_desc,
        "status": "pending",
        "conditions": [{
            "type": condition_type,
            "target_id": target_id,
            "required_count": 1,
            "current_count": 0,
        }],
        "awards": [
            {"type": "exp", "value": exp_reward},
            {"type": "gold", "value": gold_reward},
        ],
        "created_at": now,
        "completed_at": None,
    }

    # 写入 DynamoDB
    try:
        table = dynamodb.Table(table_name("Tasks"))
        table.put_item(Item=task_item)
        logger.info(f"Task created by code: {task_id} ({task_title}) for player={player_id}")
        return _convert_decimals(task_item)
    except Exception as e:
        logger.error(f"Failed to create task by code: {e}")
        return None


def _prefetch_game_data(player_id: str, npc_id: str) -> dict:
    """Pre-fetch all game data in parallel using ThreadPoolExecutor.

    Queries DynamoDB for player info, events, tasks, monsters, and items
    concurrently, then optionally queries Knowledge Base for monsters/items.

    Returns:
        dict with keys: player_info, events, tasks, monsters, items, debug_log
    """
    debug_log = []

    def _query_player_info():
        table = dynamodb.Table(table_name("Players"))
        resp = table.get_item(Key={"player_id": player_id})
        return resp.get("Item", {})

    def _query_player_events():
        table = dynamodb.Table(table_name("PlayerEventSummary"))
        resp = table.query(
            KeyConditionExpression="player_id = :pid",
            ExpressionAttributeValues={":pid": player_id},
            ScanIndexForward=False,
            Limit=10,
        )
        return resp.get("Items", [])

    def _query_player_tasks():
        table = dynamodb.Table(table_name("Tasks"))
        resp = table.query(
            IndexName="player_id-index",
            KeyConditionExpression="player_id = :pid",
            ExpressionAttributeValues={":pid": player_id},
        )
        items = resp.get("Items", [])
        while "LastEvaluatedKey" in resp:
            resp = table.query(
                IndexName="player_id-index",
                KeyConditionExpression="player_id = :pid",
                ExpressionAttributeValues={":pid": player_id},
                ExclusiveStartKey=resp["LastEvaluatedKey"],
            )
            items.extend(resp.get("Items", []))
        return items

    def _query_monsters():
        table = dynamodb.Table(table_name("Monsters"))
        resp = table.scan()
        items = resp.get("Items", [])
        while "LastEvaluatedKey" in resp:
            resp = table.scan(ExclusiveStartKey=resp["LastEvaluatedKey"])
            items.extend(resp.get("Items", []))
        return items

    def _query_items():
        table = dynamodb.Table(table_name("Items"))
        resp = table.scan()
        items = resp.get("Items", [])
        while "LastEvaluatedKey" in resp:
            resp = table.scan(ExclusiveStartKey=resp["LastEvaluatedKey"])
            items.extend(resp.get("Items", []))
        return items

    # Run all 5 queries in parallel
    results = {}
    task_map = {
        "player_info": _query_player_info,
        "events": _query_player_events,
        "tasks": _query_player_tasks,
        "monsters": _query_monsters,
        "items": _query_items,
    }

    prefetch_start = time.time()
    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = {executor.submit(fn): key for key, fn in task_map.items()}
        for future in as_completed(futures):
            key = futures[future]
            try:
                results[key] = future.result()
            except Exception as e:
                logger.error(f"Prefetch failed for {key}: {e}")
                results[key] = [] if key != "player_info" else {}

    prefetch_ms = round((time.time() - prefetch_start) * 1000)
    debug_log.append({
        "type": "data_prefetch",
        "source": "DynamoDB",
        "queries": list(task_map.keys()),
        "ms": prefetch_ms,
    })

    results["debug_log"] = debug_log
    return results


def _serialize_for_prompt(data) -> str:
    """Serialize data to JSON string, converting DynamoDB Decimal types."""
    return json.dumps(_convert_decimals(data), ensure_ascii=False)


def _strip_monster_fields(monsters: list) -> list:
    """Strip non-essential fields from monster data to reduce token count."""
    keep = {"monster_id", "name", "level", "hp", "attack", "defense", "drop_items"}
    stripped = []
    for m in monsters:
        entry = {k: v for k, v in m.items() if k in keep}
        if "drop_items" in entry:
            entry["drop_items"] = [{"item_id": d["item_id"]} for d in entry["drop_items"]]
        stripped.append(entry)
    return stripped


def _strip_item_fields(items: list) -> list:
    """Strip non-essential fields from item data to reduce token count."""
    keep = {"item_id", "name", "type", "effect"}
    return [{k: v for k, v in item.items() if k in keep} for item in items]


def handle_npc_dialogue_core(player_id: str, npc_id: str) -> dict:
    """
    处理 NPC 对话请求。

    流程：
    1. 验证 NPC 存在
    2. 预取所有玩家和游戏字典数据（并行查询）
    3. 构建 system prompt（NPC 人设 + 任务规则）
    4. 将所有数据注入 user message
    5. 调用 Strands Agent（提供 create_task 工具 + Memory）
    6. 从 Agent 响应中提取对话和任务信息
    """
    total_start = time.time()
    logger.info(f"Handling NPC dialogue: player_id={player_id}, npc_id={npc_id}")

    # 1. 校验 NPC（从内存字典或 DynamoDB）
    npc_table = dynamodb.Table(table_name("NPCs"))
    try:
        resp = npc_table.get_item(Key={"npc_id": npc_id})
    except Exception as e:
        raise ValueError(f"无法查询 NPC 字典表: {e}")

    if "Item" not in resp:
        raise ValueError(f"npc_id '{npc_id}' 不存在于 NPC 字典表中")

    npc_info = resp["Item"]
    logger.info(f"NPC found: {npc_info['name']} ({npc_id})")

    # 2. 预取所有游戏数据（并行）
    game_data = _prefetch_game_data(player_id, npc_id)
    debug_log = game_data["debug_log"]

    # 3. 构建 system prompt
    system_prompt = SYSTEM_PROMPT_TEMPLATE.format(
        npc_name=npc_info["name"],
        npc_role=npc_info["role"],
        npc_personality=npc_info["personality"],
    )

    # 4. 代码创建任务（不依赖 LLM）
    task_obj = _create_task_by_code(player_id, npc_id, game_data)
    if task_obj:
        debug_log.append({
            "type": "tool_call",
            "name": "create_task",
            "input": {"title": task_obj["title"], "target": task_obj["conditions"][0]["target_id"]},
        })
        debug_log.append({
            "type": "tool_result",
            "toolUseId": "code",
            "result": json.dumps({"success": True, "task_id": task_obj["task_id"]}),
        })

    # 5. 构建 user message（任务已创建，LLM 只生成对话）
    player_info_json = _serialize_for_prompt(game_data["player_info"])
    events_json = _serialize_for_prompt(game_data["events"])
    task_desc = ""
    if task_obj:
        task_desc = f"你刚刚给玩家下发了任务「{task_obj['title']}」：{task_obj['description']}。"
    else:
        task_desc = "当前没有适合的新任务。"

    user_message = (
        f"玩家 {player_id} 来找 NPC {npc_info['name']}（npc_id={npc_id}）对话。\n\n"
        f"## 玩家信息\n{player_info_json}\n\n"
        f"## 已创建的任务\n{task_desc}\n\n"
        f"请直接以NPC口吻说出任务内容，极其简短，1-2句话。\n"
        f"注意：NPC的寒暄语已经单独生成，不要重复寒暄。\n"
        f"不要对玩家使用称呼（如'勇士'、'冒险者'、'年轻人'等），寒暄语中已经称呼过了。"
    )

    # 5. 创建 Memory Session Manager（有状态对话）
    session_mgr = create_session_manager(player_id, npc_id)
    has_memory = session_mgr is not None

    debug_log.append({
        "type": "memory",
        "action": "session_init",
        "enabled": has_memory,
        "actor_id": player_id,
        "session_id": f"{player_id}_{npc_id}" if has_memory else None,
    })

    # 6. Log LLM configuration
    debug_log.append({
        "type": "llm",
        "action": "invoke",
        "model_id": BEDROCK_MODEL_ID,
        "region": BEDROCK_REGION,
        "prompt_caching": _is_anthropic,
        "npc": npc_info["name"],
    })

    # 7. 调用 Strands Agent
    reset_call_log()
    agent_start = time.time()
    agent = None
    try:
        if session_mgr is not None:
            with session_mgr as sm:
                agent = create_npc_agent(system_prompt, session_manager=sm)
                result = agent(user_message)
        else:
            agent = create_npc_agent(system_prompt)
            result = agent(user_message)

        agent_ms = round((time.time() - agent_start) * 1000)
        logger.info(f"Agent completed in {agent_ms}ms (memory={has_memory})")

        # Extract the agent's final text response
        dialogue_text = str(result)

        # Extract tool call info from agent messages for debug_log
        for msg in agent.messages:
            if msg.get("role") == "assistant":
                for content_block in msg.get("content", []):
                    if "toolUse" in content_block:
                        tool_use = content_block["toolUse"]
                        debug_log.append({
                            "type": "tool_call",
                            "name": tool_use.get("name", ""),
                            "input": tool_use.get("input", {}),
                        })
            if msg.get("role") == "user":
                for content_block in msg.get("content", []):
                    if "toolResult" in content_block:
                        tool_result = content_block["toolResult"]
                        result_text = ""
                        for r_content in tool_result.get("content", []):
                            if "text" in r_content:
                                result_text = r_content["text"][:200]
                                break
                        debug_log.append({
                            "type": "tool_result",
                            "toolUseId": tool_result.get("toolUseId", ""),
                            "result": result_text,
                        })

    except Exception as e:
        agent_ms = round((time.time() - agent_start) * 1000)
        logger.error(f"Agent call failed after {agent_ms}ms: {e}", exc_info=True)
        debug_log.append({
            "type": "error",
            "message": str(e),
            "ms": agent_ms,
        })
        dialogue_text = (
            f"（{npc_info['name']}看起来在思考什么）"
            f"抱歉，我现在有些走神……你稍后再来找我吧。"
        )

    # task_obj already created by code above

    total_ms = round((time.time() - total_start) * 1000)
    logger.info(f"NPC dialogue completed: npc={npc_info['name']}, total={total_ms}ms (agent={agent_ms}ms, memory={has_memory})")

    debug_log.append({
        "type": "timing",
        "label": "总耗时",
        "total_ms": total_ms,
        "details": {"agent": agent_ms, "memory_enabled": has_memory},
    })

    return {
        "dialogue": dialogue_text,
        "npc_id": npc_id,
        "npc_name": npc_info["name"],
        "player_id": player_id,
        "task": task_obj,
        "debug_log": debug_log,
    }


def _extract_created_task(messages: list) -> dict | None:
    """Extract the created task from agent tool call results."""
    for msg in messages:
        if msg.get("role") != "user":
            continue
        for content_block in msg.get("content", []):
            if "toolResult" not in content_block:
                continue
            tool_result = content_block["toolResult"]
            for r_content in tool_result.get("content", []):
                if "text" not in r_content:
                    continue
                try:
                    data = json.loads(r_content["text"])
                    if isinstance(data, dict) and data.get("success") and data.get("task_id"):
                        # This is a create_task success result, query the full task
                        table = dynamodb.Table(table_name("Tasks"))
                        resp = table.get_item(Key={"task_id": data["task_id"]})
                        task_item = resp.get("Item")
                        if task_item:
                            return _convert_decimals(task_item)
                except (json.JSONDecodeError, KeyError):
                    continue
    return None


def handle_pre_generate(player_id: str, event_type: str, event_details: dict, npc_id: str = None) -> dict:
    """
    事件驱动的预生成：在玩家产生行为事件时异步调用，
    提前生成任务和对话，缓存到 game-server 等玩家对话时即时下发。

    流程：
    1. 使用调用方指定的 NPC（如未指定，根据事件类型选择）
    2. 预取游戏数据
    3. 构建 event-aware prompt
    4. 调用 Strands Agent（含 Memory + create_task 工具）
    """
    total_start = time.time()
    logger.info(f"Pre-generate: player={player_id}, event={event_type}, npc_id={npc_id}, details={event_details}")

    # 1. 使用指定的 NPC，或根据事件类型选择
    if not npc_id:
        npc_id = _select_npc_for_event(event_type, event_details)
    logger.info(f"Pre-generate: npc={npc_id} for event={event_type}")

    # 2. 校验 NPC
    npc_table = dynamodb.Table(table_name("NPCs"))
    try:
        resp = npc_table.get_item(Key={"npc_id": npc_id})
    except Exception as e:
        logger.error(f"Pre-generate: NPC query failed: {e}")
        return {"dialogue": None, "npc_id": npc_id, "task": None, "debug_log": []}

    if "Item" not in resp:
        logger.error(f"Pre-generate: NPC {npc_id} not found")
        return {"dialogue": None, "npc_id": npc_id, "task": None, "debug_log": []}

    npc_info = resp["Item"]

    # 3. 预取数据
    game_data = _prefetch_game_data(player_id, npc_id)
    debug_log = game_data["debug_log"]

    event_desc = _describe_event(event_type, event_details)

    # 将事件写入 Memory（无论是否有 active task，事件都要记录）
    target_name = ""
    if event_type in ("battle_victory", "battle_defeat"):
        target_name = event_details.get("monster_name", "")
    elif event_type in ("item_acquired", "item_used"):
        target_name = _resolve_target_name(event_type, event_details.get("item_id", ""))
    save_event_to_memory(player_id, event_type, event_desc, target_name=target_name)
    debug_log.append({
        "type": "memory",
        "action": "save_event",
        "event_type": event_type,
        "description": event_desc,
    })

    # 检查是否已有该 NPC 的 pending/in_progress 任务
    existing_tasks = game_data.get("tasks", [])
    has_active_task = any(
        t.get("npc_id") == npc_id and t.get("status") in ("pending", "in_progress")
        for t in existing_tasks
    )
    if has_active_task:
        logger.info(f"Pre-generate: player already has active task from {npc_id}, skipping")
        return {"dialogue": None, "npc_id": npc_id, "task": None, "debug_log": debug_log}

    # 4. 构建 system prompt
    system_prompt = SYSTEM_PROMPT_TEMPLATE.format(
        npc_name=npc_info["name"],
        npc_role=npc_info["role"],
        npc_personality=npc_info["personality"],
    )

    # 5. 代码创建任务
    task_obj = _create_task_by_code(player_id, npc_id, game_data)
    if task_obj:
        debug_log.append({
            "type": "tool_call",
            "name": "create_task",
            "input": {"title": task_obj["title"], "target": task_obj["conditions"][0]["target_id"]},
        })

    # 6. 构建 user message（任务已创建，LLM 只生成对话）
    player_info_json = _serialize_for_prompt(game_data["player_info"])
    task_desc = ""
    if task_obj:
        task_desc = f"你刚刚给玩家下发了任务「{task_obj['title']}」：{task_obj['description']}。"
    else:
        task_desc = "当前没有适合的新任务。"

    user_message = (
        f"玩家 {player_id} 刚刚发生了事件：{event_desc}\n"
        f"NPC {npc_info['name']}（npc_id={npc_id}）要和玩家对话。\n\n"
        f"## 玩家信息\n{player_info_json}\n\n"
        f"## 已创建的任务\n{task_desc}\n\n"
        f"请直接以NPC口吻说出任务内容，极其简短，1-2句话。\n"
        f"不要重复提及「{event_desc}」这件事（寒暄语已提及）。\n"
        f"不要对玩家使用称呼（如'勇士'、'冒险者'、'年轻人'等），寒暄语中已经称呼过了。\n"
    )

    # 6. 创建 Memory Session Manager
    session_mgr = create_session_manager(player_id, npc_id)
    has_memory = session_mgr is not None

    debug_log.append({
        "type": "memory",
        "action": "session_init",
        "enabled": has_memory,
        "actor_id": player_id,
        "session_id": f"{player_id}_{npc_id}" if has_memory else None,
    })

    debug_log.append({
        "type": "llm",
        "action": "invoke",
        "model_id": BEDROCK_MODEL_ID,
        "region": BEDROCK_REGION,
        "prompt_caching": _is_anthropic,
        "npc": npc_info["name"],
        "mode": "pre_generate",
    })

    # 7. 调用 Strands Agent
    reset_call_log()
    agent_start = time.time()
    agent = None
    try:
        if session_mgr is not None:
            with session_mgr as sm:
                agent = create_npc_agent(system_prompt, session_manager=sm)
                result = agent(user_message)
        else:
            agent = create_npc_agent(system_prompt)
            result = agent(user_message)

        agent_ms = round((time.time() - agent_start) * 1000)
        logger.info(f"Pre-generate agent completed in {agent_ms}ms")
        dialogue_text = str(result)

    except Exception as e:
        agent_ms = round((time.time() - agent_start) * 1000)
        logger.error(f"Pre-generate agent failed after {agent_ms}ms: {e}", exc_info=True)
        debug_log.append({"type": "error", "message": str(e), "ms": agent_ms})
        dialogue_text = None

    # task_obj already created by code above

    total_ms = round((time.time() - total_start) * 1000)
    logger.info(f"Pre-generate completed: npc={npc_info['name']}, total={total_ms}ms")

    debug_log.append({
        "type": "timing",
        "label": "预生成总耗时",
        "total_ms": total_ms,
        "details": {"agent": agent_ms, "memory_enabled": has_memory, "event_type": event_type},
    })

    return {
        "dialogue": dialogue_text,
        "npc_id": npc_id,
        "npc_name": npc_info["name"],
        "player_id": player_id,
        "task": task_obj,
        "debug_log": debug_log,
    }


def _select_npcs_for_event(event_type: str, event_details: dict) -> list:
    """根据事件类型选择最匹配的 NPC 列表（仅村长，其他NPC对话时生成）。"""
    return ["npc_elder"]


def _select_npc_for_event(event_type: str, event_details: dict) -> str:
    """根据事件类型选择最匹配的单个 NPC（向后兼容）。"""
    return _select_npcs_for_event(event_type, event_details)[0]


def _describe_event(event_type: str, event_details: dict) -> str:
    """将事件类型和详情转换为中文描述。"""
    descriptions = {
        "player_login": "新玩家登录" if event_details.get("is_new") else "玩家回归登录",
        "battle_victory": f"战斗胜利，击败了 {event_details.get('monster_name', '怪物')}",
        "battle_defeat": f"战斗失败，败给了 {event_details.get('monster_name', '怪物')}",
        "task_completed": f"完成了任务「{event_details.get('title', '未知任务')}」",
        "item_used": f"使用了道具 {event_details.get('item_id', '未知道具')}",
        "item_acquired": f"获得了道具 {event_details.get('item_id', '未知道具')}",
        "level_up": f"升级到 Lv.{event_details.get('new_level', '?')}",
    }
    return descriptions.get(event_type, f"发生了事件 {event_type}")


def _convert_decimals(obj):
    """Convert DynamoDB Decimal types to int/float for JSON serialization."""
    if isinstance(obj, decimal.Decimal):
        return int(obj) if obj == int(obj) else float(obj)
    if isinstance(obj, dict):
        return {k: _convert_decimals(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_convert_decimals(i) for i in obj]
    return obj


# ---- NPC-Specific Greeting Templates (rule-based, no LLM needed) ----

_NPC_GREETINGS = {
    "npc_elder": {
        "battle_victory": "年轻人，听说你击败了{target}，老夫甚感欣慰。",
        "battle_defeat": "别灰心，{target}确实不好对付，老夫年轻时也吃过不少亏。",
        "task_completed": "干得好，你的成长老夫都看在眼里。",
        "item_acquired": "哦？你得到了{target}，不错不错。",
        "item_used": "善用物资是冒险者的基本素养，做得好。",
        "level_up": "恭喜你变得更强了！老夫看到了你身上的潜力。",
        "talk_to_npc": "又来了？好，坐下说吧。",
        "_default": "年轻的冒险者，欢迎来到勇者大陆。老夫这里总有些事情需要帮忙。",
    },
    "npc_blacksmith": {
        "battle_victory": "嘿！打赢了{target}？不赖嘛，武器没卷刃吧？",
        "battle_defeat": "输给{target}了？哼，肯定是装备不行，来我这看看。",
        "task_completed": "活儿干得漂亮！够爽快！",
        "item_acquired": "哦，弄到{target}了？拿来让我瞧瞧成色。",
        "item_used": "东西就是拿来用的，别舍不得！",
        "level_up": "块头又大了？那得配把更趁手的家伙！",
        "talk_to_npc": "来啦？炉子正热着呢，有啥事快说。",
        "_default": "锤子和铁砧就是我的语言，有什么需要尽管开口。",
    },
    "npc_merchant": {
        "battle_victory": "听说你赢了{target}？战利品打算怎么处理呀？",
        "battle_defeat": "哎呀，{target}那么厉害？要不要看看我这有什么好东西？",
        "task_completed": "任务完成啦？奖励到手的感觉不错吧～",
        "item_acquired": "嗯？{target}？识货嘛，这东西可值不少。",
        "item_used": "用掉了？没关系，我这里货源充足～",
        "level_up": "升级了呀！更强了就能赚更多，嘻嘻。",
        "talk_to_npc": "欢迎光临～今天想看点什么？",
        "_default": "旅途中总需要些好东西傍身，来看看吧～",
    },
    "npc_healer": {
        "battle_victory": "你击败了{target}？有没有受伤？让我看看。",
        "battle_defeat": "天哪，你受伤了！快过来，我帮你处理一下。",
        "task_completed": "辛苦了，记得照顾好自己的身体哦。",
        "item_acquired": "你拿到了{target}？如果是药材的话我可以帮你鉴定。",
        "item_used": "嗯，按时用药是好习惯，身体是冒险的本钱。",
        "level_up": "变强了呢！不过越强越要注意休息哦。",
        "talk_to_npc": "你来了，最近身体还好吗？",
        "_default": "冒险者你好，需要治疗或者药水吗？",
    },
}

# Cache for name resolution (populated on first use)
_name_cache = {}


def _resolve_target_name(event_type: str, target_id: str) -> str:
    """Resolve a target_id to its Chinese display name using DynamoDB dictionaries."""
    if not target_id:
        return ""
    if target_id in _name_cache:
        return _name_cache[target_id]

    # Determine which table to query based on event type
    table_map = {
        "battle_victory": ("Monsters", "monster_id"),
        "battle_defeat": ("Monsters", "monster_id"),
        "kill_monster": ("Monsters", "monster_id"),
        "item_acquired": ("Items", "item_id"),
        "item_used": ("Items", "item_id"),
        "collect_item": ("Items", "item_id"),
        "use_item": ("Items", "item_id"),
        "talk_to_npc": ("NPCs", "npc_id"),
        "task_accepted": ("Tasks", "task_id"),
        "task_completed": ("Tasks", "task_id"),
    }
    mapping = table_map.get(event_type)
    if not mapping:
        return target_id

    tbl_name, key_attr = mapping
    try:
        tbl = dynamodb.Table(table_name(tbl_name))
        resp = tbl.get_item(Key={key_attr: target_id})
        item = resp.get("Item", {})
        name = item.get("name") or item.get("title") or target_id
        _name_cache[target_id] = name
        return name
    except Exception:
        return target_id


def generate_greeting(player_id: str, npc_id: str) -> dict:
    """根据玩家最近行为生成 NPC 寒暄语（纯规则模板，无需 LLM，极快）。

    优先从 AgentCore Memory 读取最近事件，Memory 不可用时 fallback 到 DynamoDB。

    Returns:
        {"greeting": str, "npc_id": str, "npc_name": str, "player_id": str}
    """
    start = time.time()

    # 1. 查询 NPC 信息
    npc_table = dynamodb.Table(table_name("NPCs"))
    try:
        resp = npc_table.get_item(Key={"npc_id": npc_id})
        npc_info = resp.get("Item", {})
    except Exception:
        npc_info = {}
    npc_name = npc_info.get("name", npc_id)

    GAME_EVENT_TYPES = {
        "battle_victory", "battle_defeat", "task_completed",
        "item_acquired", "item_used", "level_up",
    }
    npc_templates = _NPC_GREETINGS.get(npc_id, _NPC_GREETINGS["npc_elder"])
    greeting = npc_templates.get("_default", "你好，冒险者。")
    source = "default"

    # 2. 优先从 Memory 读取最近事件
    memory_event = get_recent_event_from_memory(player_id)
    if memory_event:
        event_type = memory_event.get("event_type", "")
        if event_type in GAME_EVENT_TYPES:
            template = npc_templates.get(event_type)
            if template:
                target = memory_event.get("target_name", "")
                greeting = template.format(target=target)
                source = "memory"

    # 3. Fallback: 从 DynamoDB PlayerEventSummary 读取
    if source == "default":
        try:
            events_table = dynamodb.Table(table_name("PlayerEventSummary"))
            resp = events_table.query(
                KeyConditionExpression="player_id = :pid",
                ExpressionAttributeValues={":pid": player_id},
            )
            events = resp.get("Items", [])
            if events:
                events.sort(key=lambda e: e.get("timestamp", ""), reverse=True)
                game_events = [e for e in events if e.get("event_type", "") in GAME_EVENT_TYPES]
                if game_events:
                    event = game_events[0]
                    event_type = event.get("event_type", "")
                    target_id = event.get("target_id", "")
                    target_name = _resolve_target_name(event_type, target_id)
                    template = npc_templates.get(event_type)
                    if template:
                        greeting = template.format(target=target_name)
                        source = "dynamodb"
        except Exception as e:
            logger.warning(f"Failed to query events for greeting: {e}")

    ms = round((time.time() - start) * 1000)
    logger.info(f"Greeting generated in {ms}ms for player={player_id}, npc={npc_name}, source={source}")

    return {
        "greeting": greeting,
        "npc_id": npc_id,
        "npc_name": npc_name,
        "player_id": player_id,
    }


# ---- FastAPI HTTP server (local debug entry point) ----

app = FastAPI(
    title="NPC Agent Service",
    description="AI-driven NPC dialogue and task generation service (Strands Agent + Tool Use + Memory).",
    version="2.0.0",
)


class DialogueRequest(BaseModel):
    player_id: str
    npc_id: str


class DialogueResponse(BaseModel):
    dialogue: str
    npc_id: str
    npc_name: str
    player_id: str
    task: dict | None = None
    debug_log: list = []


class GreetingResponse(BaseModel):
    greeting: str
    npc_id: str
    npc_name: str
    player_id: str


@app.post("/agent/dialogue", response_model=DialogueResponse)
async def dialogue(request: DialogueRequest):
    try:
        result = handle_npc_dialogue_core(request.player_id, request.npc_id)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
        raise HTTPException(status_code=500, detail=f"NPC Agent 服务内部错误: {str(e)}")


class PreGenerateRequest(BaseModel):
    player_id: str
    event_type: str
    event_details: dict = {}
    npc_id: str = None


@app.post("/agent/pre_generate", response_model=DialogueResponse)
async def pre_generate(request: PreGenerateRequest):
    try:
        result = handle_pre_generate(request.player_id, request.event_type, request.event_details, npc_id=request.npc_id)
        return result
    except Exception as e:
        logger.error(f"Pre-generate error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/agent/greeting", response_model=GreetingResponse)
async def greeting(request: DialogueRequest):
    try:
        result = generate_greeting(request.player_id, request.npc_id)
        return result
    except Exception as e:
        logger.error(f"Greeting error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "npc-agent", "mode": "strands-agent-tool-use"}


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8090))
    logger.info(f"Starting NPC Agent service on port {port}")
    uvicorn.run(app, host="0.0.0.0", port=port)
