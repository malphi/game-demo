"""
NPC AI Agent 主入口模块。

基于 Amazon Bedrock 大模型驱动，预获取所有数据后一次性调用 LLM，
LLM 直接输出 JSON（包含任务和对话），无需工具调用，实现单次 API 请求完成。

Usage:
    python agent.py
    # 服务启动后访问 POST http://localhost:8090/agent/dialogue
"""

import os
import json
import logging
import decimal
import time
import re
from pathlib import Path

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import uvicorn

import boto3

# ---- Logging setup ----
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

# ---- DynamoDB resource ----
from db_config import dynamodb, table_name

# ---- Validation ----
from validation.task_validator import validate_task

# ---- Load system prompt template ----
PROMPT_DIR = Path(__file__).parent / "prompts"
SYSTEM_PROMPT_TEMPLATE = (PROMPT_DIR / "npc_system_prompt.txt").read_text(encoding="utf-8")

# ---- Bedrock model configuration ----
BEDROCK_MODEL_ID = os.environ.get(
    "BEDROCK_MODEL_ID", "us.anthropic.claude-4-5-haiku-20251001-v1:0"
)
BEDROCK_REGION = os.environ.get("BEDROCK_REGION", "us-west-2")

# ---- Bedrock client (reuse across requests) ----
_bedrock_client = None

def get_bedrock_client():
    global _bedrock_client
    if _bedrock_client is None:
        _bedrock_client = boto3.client(
            "bedrock-runtime",
            region_name=BEDROCK_REGION,
        )
    return _bedrock_client


def _convert_decimals(obj):
    """Convert DynamoDB Decimal types to int/float for JSON serialization."""
    if isinstance(obj, decimal.Decimal):
        return int(obj) if obj == int(obj) else float(obj)
    if isinstance(obj, dict):
        return {k: _convert_decimals(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_convert_decimals(i) for i in obj]
    return obj


def _scan_table(base_name: str) -> list:
    """Scan a full DynamoDB table, handling pagination."""
    table = dynamodb.Table(table_name(base_name))
    resp = table.scan()
    items = resp.get("Items", [])
    while "LastEvaluatedKey" in resp:
        resp = table.scan(ExclusiveStartKey=resp["LastEvaluatedKey"])
        items.extend(resp.get("Items", []))
    return items


def _query_by_player(base_name: str, player_id: str, index: str = None, limit: int = None) -> list:
    """Query a DynamoDB table by player_id."""
    table = dynamodb.Table(table_name(base_name))
    kwargs = {
        "KeyConditionExpression": "player_id = :pid",
        "ExpressionAttributeValues": {":pid": player_id},
    }
    if index:
        kwargs["IndexName"] = index
    if limit:
        kwargs["Limit"] = limit
        kwargs["ScanIndexForward"] = False
    resp = table.query(**kwargs)
    items = resp.get("Items", [])
    if not limit:
        while "LastEvaluatedKey" in resp:
            kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]
            resp = table.query(**kwargs)
            items.extend(resp.get("Items", []))
    return items


def prefetch_all_data(player_id: str) -> dict:
    """Pre-fetch all data needed by the LLM in one batch."""
    timings = {}

    t0 = time.time()
    try:
        table = dynamodb.Table(table_name("Players"))
        resp = table.get_item(Key={"player_id": player_id})
        player_info = resp.get("Item", {})
    except Exception as e:
        logger.error(f"Failed to get player info: {e}")
        player_info = {}
    timings["player_info"] = round((time.time() - t0) * 1000)

    t0 = time.time()
    try:
        player_events = _query_by_player("PlayerEventSummary", player_id, limit=20)
    except Exception as e:
        logger.error(f"Failed to get player events: {e}")
        player_events = []
    timings["player_events"] = round((time.time() - t0) * 1000)

    t0 = time.time()
    try:
        monsters = _scan_table("Monsters")
    except Exception as e:
        logger.error(f"Failed to get monsters: {e}")
        monsters = []
    timings["monsters"] = round((time.time() - t0) * 1000)

    t0 = time.time()
    try:
        items = _scan_table("Items")
    except Exception as e:
        logger.error(f"Failed to get items: {e}")
        items = []
    timings["items"] = round((time.time() - t0) * 1000)

    t0 = time.time()
    try:
        npcs = _scan_table("NPCs")
    except Exception as e:
        logger.error(f"Failed to get npcs: {e}")
        npcs = []
    timings["npcs"] = round((time.time() - t0) * 1000)

    t0 = time.time()
    try:
        player_tasks = _query_by_player("Tasks", player_id, index="player_id-index")
    except Exception as e:
        logger.error(f"Failed to get player tasks: {e}")
        player_tasks = []
    timings["player_tasks"] = round((time.time() - t0) * 1000)

    return {
        "player_info": _convert_decimals(player_info),
        "player_events": _convert_decimals(player_events),
        "monsters": _convert_decimals(monsters),
        "items": _convert_decimals(items),
        "npcs": _convert_decimals(npcs),
        "player_tasks": _convert_decimals(player_tasks),
        "timings": timings,
    }


def call_bedrock_direct(system_prompt: str, user_message: str) -> str:
    """
    Call Bedrock Converse API directly (no tool use) for single-round-trip response.
    """
    client = get_bedrock_client()
    response = client.converse(
        modelId=BEDROCK_MODEL_ID,
        system=[{"text": system_prompt}],
        messages=[
            {"role": "user", "content": [{"text": user_message}]},
        ],
        inferenceConfig={
            "maxTokens": 1024,
            "temperature": 0.7,
        },
    )
    # Extract text from response
    output = response.get("output", {})
    message = output.get("message", {})
    content = message.get("content", [])
    text_parts = [block["text"] for block in content if "text" in block]
    return "\n".join(text_parts)


def parse_llm_json(text: str) -> dict:
    """Extract JSON from LLM response (handles markdown code blocks)."""
    # Try to extract from ```json ... ``` block
    match = re.search(r'```(?:json)?\s*\n?(.*?)\n?```', text, re.DOTALL)
    if match:
        text = match.group(1)
    # Try direct JSON parse
    text = text.strip()
    return json.loads(text)


def create_task_from_json(player_id: str, npc_id: str, task_json: dict) -> dict:
    """Validate and write task to DynamoDB from LLM JSON output."""
    import uuid
    from datetime import datetime, timezone

    task_data = {
        "player_id": player_id,
        "npc_id": npc_id,
        "title": task_json.get("title", ""),
        "description": task_json.get("description", ""),
        "conditions": task_json.get("conditions", []),
        "awards": task_json.get("awards", []),
    }

    # Validate
    validation = validate_task(task_data)
    if not validation["valid"]:
        logger.warning(f"Task validation failed: {validation['reason']}")
        return {"success": False, "reason": validation["reason"]}

    # Generate task ID and write
    task_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()

    task_item = {
        "task_id": task_id,
        "player_id": player_id,
        "npc_id": npc_id,
        "title": task_data["title"],
        "description": task_data["description"],
        "status": "pending",
        "conditions": task_data["conditions"],
        "awards": task_data["awards"],
        "created_at": now,
        "completed_at": None,
    }

    for condition in task_item["conditions"]:
        if "current_count" not in condition:
            condition["current_count"] = 0

    try:
        table = dynamodb.Table(table_name("Tasks"))
        table.put_item(Item=task_item)
        logger.info(f"Task created: task_id={task_id}, title={task_data['title']}")
        return {"success": True, "task": task_item}
    except Exception as e:
        logger.error(f"Failed to write task: {e}")
        return {"success": False, "reason": [str(e)]}


def handle_npc_dialogue_core(player_id: str, npc_id: str) -> dict:
    """
    处理 NPC 对话请求。

    优化流程（单次 LLM 调用）：
    1. 验证 NPC 存在
    2. 检查未完成任务
    3. 预获取所有数据
    4. 单次 LLM 调用获取 JSON（含任务+对话）
    5. 解析 JSON，校验并写入任务
    """
    total_start = time.time()
    llm_ms = 0
    logger.info(f"Handling NPC dialogue: player_id={player_id}, npc_id={npc_id}")

    # 1. 校验 NPC
    npc_table = dynamodb.Table(table_name("NPCs"))
    try:
        resp = npc_table.get_item(Key={"npc_id": npc_id})
    except Exception as e:
        raise ValueError(f"无法查询 NPC 字典表: {e}")

    if "Item" not in resp:
        raise ValueError(f"npc_id '{npc_id}' 不存在于 NPC 字典表中")

    npc_info = resp["Item"]
    logger.info(f"NPC found: {npc_info['name']} ({npc_id})")

    # 2. 检查未完成任务（in_progress 或 pending 都直接返回，不调 LLM）
    try:
        tasks_table = dynamodb.Table(table_name("Tasks"))
        tasks_resp = tasks_table.query(
            IndexName="player_id-index",
            KeyConditionExpression="player_id = :pid",
            ExpressionAttributeValues={":pid": player_id},
        )
        for item in tasks_resp.get("Items", []):
            if item.get("npc_id") != npc_id:
                continue
            status = item.get("status")
            if status in ("in_progress", "pending"):
                task_title = item.get("title", "")
                task_desc = item.get("description", "")
                logger.info(f"Player {player_id} has {status} task '{task_title}' from {npc_id}, skipping LLM")
                if status == "in_progress":
                    dialogue = f"你还没完成我交给你的任务「{task_title}」呢！{task_desc}，快去吧！"
                else:
                    dialogue = f"我刚才给你说的任务「{task_title}」，你还没接受呢，要不要接？"
                return {
                    "dialogue": dialogue,
                    "npc_id": npc_id,
                    "npc_name": npc_info["name"],
                    "player_id": player_id,
                    "task": _convert_decimals(item) if status == "pending" else None,
                    "debug_log": [],
                }
    except Exception as e:
        logger.warning(f"Failed to check active tasks: {e}")

    # 3. 预获取所有数据
    prefetch_start = time.time()
    data = prefetch_all_data(player_id)
    prefetch_ms = round((time.time() - prefetch_start) * 1000)
    logger.info(f"Prefetch: {prefetch_ms}ms {data['timings']}")

    # 4. 构建精简消息
    p = data["player_info"]
    hp = int(p.get("hp", 0))
    max_hp = int(p.get("max_hp", 1))
    hp_pct = round(hp / max_hp * 100)

    player_summary = f"Lv{p.get('level',1)} HP:{hp}/{max_hp}({hp_pct}%) ATK:{p.get('attack',0)} DEF:{p.get('defense',0)} Gold:{p.get('gold',0)}"
    inv = p.get("inventory", [])
    inv_str = ", ".join(f"{i['item_id']}x{i['quantity']}" for i in inv) if inv else "空"

    monsters_slim = [{"id": m["monster_id"], "name": m.get("name",""), "lv": int(m.get("level",1))} for m in data["monsters"]]
    monsters_slim.sort(key=lambda x: x["lv"])

    items_slim = [{"id": i["item_id"], "name": i.get("name",""), "type": i.get("type","")} for i in data["items"]]
    npcs_slim = [{"id": n["npc_id"], "name": n.get("name","")} for n in data["npcs"]]

    events_str = "无"
    if data["player_events"]:
        ev_lines = [f"{ev.get('event_type','')}:{ev.get('target_id','')}={ev.get('result','')}" for ev in data["player_events"][:10]]
        events_str = "; ".join(ev_lines)

    completed_tasks_str = "无"
    active_tasks_str = "无"
    if data["player_tasks"]:
        completed_lines = []
        active_lines = []
        for t in data["player_tasks"]:
            conds = ",".join(f"{c['type']}:{c['target_id']}" for c in t.get("conditions",[]))
            entry = f"{t.get('title','未知')}({conds})"
            if t.get("status") == "completed":
                completed_lines.append(entry)
            else:
                active_lines.append(f"{t.get('status','')}|{entry}")
        if completed_lines:
            completed_tasks_str = "; ".join(completed_lines)
        if active_lines:
            active_tasks_str = "; ".join(active_lines)

    user_message = f"""玩家 {player_id} 来找你对话。

玩家: {player_summary}
背包: {inv_str}
最近事件: {events_str}
已完成任务: {completed_tasks_str}
进行中任务: {active_tasks_str}
怪物: {json.dumps(monsters_slim, ensure_ascii=False)}
道具: {json.dumps(items_slim, ensure_ascii=False)}
NPC: {json.dumps(npcs_slim, ensure_ascii=False)}"""

    system_prompt = SYSTEM_PROMPT_TEMPLATE.format(
        npc_name=npc_info["name"],
        npc_role=npc_info["role"],
        npc_personality=npc_info["personality"],
    )

    # 5. 构建 debug_log
    debug_log = []
    debug_log.append({
        "type": "timing",
        "label": "数据预获取",
        "total_ms": prefetch_ms,
        "details": data["timings"],
    })
    for key, label in [
        ("player_info", "get_player_info"),
        ("player_events", "get_player_events"),
        ("monsters", "get_available_monsters"),
        ("items", "get_available_items"),
        ("npcs", "get_available_npcs"),
        ("player_tasks", "get_player_tasks"),
    ]:
        debug_log.append({
            "type": "tool_call",
            "name": label,
            "input": {"player_id": player_id} if "player" in key else {},
        })

    # 6. 单次 LLM 调用
    llm_start = time.time()
    dialogue_text = ""
    task_obj = None
    try:
        raw_response = call_bedrock_direct(system_prompt, user_message)
        llm_ms = round((time.time() - llm_start) * 1000)
        logger.info(f"LLM response: {llm_ms}ms, length={len(raw_response)}")

        debug_log.append({
            "type": "reasoning",
            "text": raw_response[:500],
        })

        # Parse JSON
        result_json = parse_llm_json(raw_response)
        dialogue_text = result_json.get("dialogue", "")
        task_json = result_json.get("task", {})

        if task_json:
            # Validate and write task
            debug_log.append({
                "type": "tool_call",
                "name": "create_task",
                "input": task_json,
            })
            create_result = create_task_from_json(player_id, npc_id, task_json)
            if create_result["success"]:
                task_obj = _convert_decimals(create_result["task"])
                debug_log.append({
                    "type": "tool_result",
                    "result": f"success: task_id={task_obj['task_id']}",
                })
            else:
                debug_log.append({
                    "type": "tool_result",
                    "result": f"failed: {create_result.get('reason','')}",
                })
    except json.JSONDecodeError as e:
        llm_ms = round((time.time() - llm_start) * 1000)
        logger.error(f"Failed to parse LLM JSON: {e}")
        dialogue_text = (
            f"（{npc_info['name']}看起来在思考什么）"
            f"抱歉，我现在有些走神……你稍后再来找我吧。"
        )
    except Exception as e:
        llm_ms = round((time.time() - llm_start) * 1000)
        logger.error(f"LLM call failed: {e}")
        dialogue_text = (
            f"（{npc_info['name']}看起来在思考什么）"
            f"抱歉，我现在有些走神……你稍后再来找我吧。"
        )

    total_ms = round((time.time() - total_start) * 1000)
    logger.info(f"NPC dialogue completed: npc={npc_info['name']}, total={total_ms}ms (prefetch={prefetch_ms}ms, llm={llm_ms}ms)")

    debug_log.append({
        "type": "timing",
        "label": "总耗时",
        "total_ms": total_ms,
        "details": {"prefetch": prefetch_ms, "llm": llm_ms},
    })

    return {
        "dialogue": dialogue_text,
        "npc_id": npc_id,
        "npc_name": npc_info["name"],
        "player_id": player_id,
        "task": task_obj,
        "debug_log": debug_log,
    }


# ---- FastAPI HTTP server ----

app = FastAPI(
    title="NPC Agent Service",
    description="AI-driven NPC dialogue and task generation service for the RPG game demo.",
    version="1.0.0",
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


@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "npc-agent"}


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8090))
    logger.info(f"Starting NPC Agent service on port {port}")
    uvicorn.run(app, host="0.0.0.0", port=port)
