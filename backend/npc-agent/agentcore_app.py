"""
AgentCore Runtime entry point for the NPC AI Agent.

Wraps the existing dialogue logic with BedrockAgentCoreApp so it can run
on Amazon Bedrock AgentCore Runtime in production, while the FastAPI server
(agent.py) remains available for local development.

Usage (AgentCore Runtime deploys this automatically):
    python agentcore_app.py
"""

import json
import logging

from bedrock_agentcore import BedrockAgentCoreApp

from agent import handle_npc_dialogue_core

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

app = BedrockAgentCoreApp()


@app.entrypoint
def npc_dialogue_handler(request):
    """AgentCore entry point. Receives {player_id, npc_id}, returns JSON."""
    player_id = request.get("player_id")
    npc_id = request.get("npc_id")

    if not player_id or not npc_id:
        return json.dumps({"error": "player_id and npc_id are required"})

    try:
        result = handle_npc_dialogue_core(player_id, npc_id)
        return json.dumps(result)
    except ValueError as e:
        logger.error(f"Validation error: {e}")
        return json.dumps({"error": str(e)})
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
        return json.dumps({"error": f"NPC Agent internal error: {str(e)}"})


app.run()
