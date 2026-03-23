"""
AgentCore Runtime entry point for the NPC AI Agent.

Wraps the Strands Agent dialogue logic with BedrockAgentCoreApp so it can run
on Amazon Bedrock AgentCore Runtime in production, while the FastAPI server
(agent.py) remains available for local development.

Usage (AgentCore Runtime deploys this automatically):
    python agentcore_app.py
"""

import json
import logging

from bedrock_agentcore import BedrockAgentCoreApp

from agent import handle_npc_dialogue_core, generate_greeting, handle_pre_generate

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

app = BedrockAgentCoreApp()


@app.entrypoint
def npc_dialogue_handler(request):
    """AgentCore entry point. Routes by 'action' field:
    - action: "greeting" → fast rule-based greeting (~100ms)
    - action: "dialogue" (default) → full LLM dialogue + task generation
    """
    player_id = request.get("player_id")
    npc_id = request.get("npc_id")
    action = request.get("action", "dialogue")

    if not player_id:
        return json.dumps({"error": "player_id is required"})

    try:
        if action == "greeting":
            if not npc_id:
                return json.dumps({"error": "npc_id is required for greeting"})
            result = generate_greeting(player_id, npc_id)
        elif action == "pre_generate":
            event_type = request.get("event_type", "unknown")
            event_details = request.get("event_details", {})
            result = handle_pre_generate(player_id, event_type, event_details)
        else:
            if not npc_id:
                return json.dumps({"error": "npc_id is required for dialogue"})
            result = handle_npc_dialogue_core(player_id, npc_id)
        return json.dumps(result, default=str)
    except ValueError as e:
        logger.error(f"Validation error: {e}")
        return json.dumps({"error": str(e)})
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
        return json.dumps({"error": f"NPC Agent internal error: {str(e)}"})


app.run()
