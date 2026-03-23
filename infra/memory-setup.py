#!/usr/bin/env python3
"""
AgentCore Memory 资源初始化脚本。

创建一个共享的 Memory 资源，配置 SemanticStrategy 和 UserPreferenceStrategy，
用于 NPC Agent 的有状态对话。

前置条件:
    pip install bedrock-agentcore

Usage:
    python memory-setup.py --region us-west-2
    python memory-setup.py --region us-west-2 --name my-game-memory
"""

import argparse

from bedrock_agentcore.memory import MemoryClient


def main():
    parser = argparse.ArgumentParser(
        description="Create AgentCore Memory resource for NPC Agent."
    )
    parser.add_argument("--region", default="us-west-2", help="AWS region")
    parser.add_argument(
        "--name",
        default="game-demo-npc-memory",
        help="Memory resource name",
    )
    args = parser.parse_args()

    print("=" * 60)
    print("AgentCore Memory Setup")
    print("=" * 60)
    print(f"  Region: {args.region}")
    print(f"  Name:   {args.name}")
    print("=" * 60)
    print()

    client = MemoryClient(region_name=args.region)

    print("Creating Memory resource (this may take 2-3 minutes)...")
    memory = client.create_memory_and_wait(
        name=args.name,
        description="NPC Agent memory for stateful player-NPC dialogue. "
        "Stores conversation history (short-term) and extracts player facts "
        "and preferences (long-term).",
        strategies=[
            {
                "semanticMemoryStrategy": {
                    "name": "PlayerFactExtractor",
                    "namespaceTemplates": ["/facts/{actorId}/"],
                }
            },
            {
                "userPreferenceMemoryStrategy": {
                    "name": "PlayerPreferenceLearner",
                    "namespaceTemplates": ["/preferences/{actorId}/"],
                }
            },
        ],
    )

    memory_id = memory.get("id")
    print()
    print("=" * 60)
    print(f"Memory resource created successfully!")
    print(f"  Memory ID: {memory_id}")
    print()
    print("Add the following environment variable to your NPC Agent:")
    print(f"  AGENTCORE_MEMORY_ID={memory_id}")
    print("=" * 60)


if __name__ == "__main__":
    main()
