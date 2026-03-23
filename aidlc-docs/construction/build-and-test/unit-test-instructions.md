# Unit Test Instructions

## Overview

This project is a demo/prototype. No automated unit test suites exist currently. Below are manual verification procedures for each unit's code changes.

## Unit 1: MCP Server Architecture (Tool Use)

### Verify Tool Definitions
```bash
cd /Users/ruofeima/code/game-demo/backend/npc-agent
python -c "from tools import get_player_info, get_player_events, get_available_monsters, get_available_items, get_available_npcs, get_player_tasks, create_task, validate_task; print('All tools imported successfully')"
```
- **Expected**: `All tools imported successfully`

### Verify Tool Decorators
```bash
python -c "
from tools import get_player_info
print(hasattr(get_player_info, '__wrapped__') or callable(get_player_info))
print('Tool name:', getattr(get_player_info, '__name__', 'unknown'))
"
```
- **Expected**: Tool function is callable with correct name

## Unit 2: Knowledge Base Integration

### Verify KB Client Module
```bash
cd /Users/ruofeima/code/game-demo/backend/npc-agent
python -c "from kb_client import query_knowledge_base; print('KB client imported successfully')"
```

### Verify KB Data Files Exist
```bash
ls -la /Users/ruofeima/code/game-demo/backend/npc-agent/kb-data/
```
- **Expected**: `monsters.md`, `items.md`, `npcs.md`, `task_rules.md` all present

### Verify KB-First Tool Pattern (get_available_monsters)
```bash
python -c "
from tools.get_monsters import get_available_monsters
import inspect
src = inspect.getsource(get_available_monsters)
assert 'query_knowledge_base' in src, 'KB query not found in get_available_monsters'
assert 'dynamodb' in src.lower() or 'table' in src.lower(), 'DynamoDB fallback not found'
print('get_available_monsters: KB-first with DynamoDB fallback - OK')
"
```

## Unit 3: AgentCore Memory Integration

### Verify Memory Config Module
```bash
cd /Users/ruofeima/code/game-demo/backend/npc-agent
python -c "
from memory_config import create_session_manager
# Without AGENTCORE_MEMORY_ID set, should return None
sm = create_session_manager('test_player', 'npc_001')
print(f'Session manager (no memory_id): {sm}')
assert sm is None, 'Should return None when AGENTCORE_MEMORY_ID not set'
print('Memory config fallback behavior: OK')
"
```

### Verify Agent Accepts Session Manager
```bash
python -c "
import inspect
from agent import create_npc_agent
sig = inspect.signature(create_npc_agent)
assert 'session_manager' in sig.parameters, 'session_manager param missing'
print('create_npc_agent accepts session_manager: OK')
"
```

### Verify System Prompt Has Memory Section
```bash
grep -q '对话记忆' /Users/ruofeima/code/game-demo/backend/npc-agent/prompts/npc_system_prompt.txt && echo 'Memory section in system prompt: OK' || echo 'MISSING'
```

## Unit 4: Latency Optimization

### Verify Module-Level BedrockModel Singleton
```bash
cd /Users/ruofeima/code/game-demo/backend/npc-agent
python -c "
import inspect
import importlib.util
spec = importlib.util.spec_from_file_location('agent', 'agent.py')
src = open('agent.py').read()
assert '_bedrock_model = BedrockModel(' in src, 'Module-level BedrockModel not found'
assert 'prompt_caching_config' in src, 'Prompt caching not configured'
print('Module-level BedrockModel with prompt caching: OK')
"
```

### Verify Greeting Function
```bash
python -c "
from agent import generate_greeting, _GREETING_TEMPLATES, _DEFAULT_GREETING
assert callable(generate_greeting), 'generate_greeting not callable'
assert len(_GREETING_TEMPLATES) >= 7, f'Expected >= 7 templates, got {len(_GREETING_TEMPLATES)}'
assert _DEFAULT_GREETING, 'Default greeting is empty'
print(f'Greeting templates: {len(_GREETING_TEMPLATES)} types + default')
print('generate_greeting function: OK')
"
```

### Verify AgentCore Routing
```bash
python -c "
src = open('/Users/ruofeima/code/game-demo/backend/npc-agent/agentcore_app.py').read()
assert 'action' in src, 'action routing not found'
assert 'generate_greeting' in src, 'generate_greeting not imported'
assert 'greeting' in src, 'greeting action handler not found'
print('AgentCore action routing (greeting/dialogue): OK')
"
```

### Verify Frontend Greeting Handler
```bash
grep -q 'npc_dialogue_greeting' /Users/ruofeima/code/game-demo/frontend/src/scenes/GameScene.js && echo 'GameScene greeting handler: OK' || echo 'MISSING'
grep -q 'showGreeting' /Users/ruofeima/code/game-demo/frontend/src/ui/DialogueBox.js && echo 'DialogueBox.showGreeting: OK' || echo 'MISSING'
grep -q 'transitionToDialogue' /Users/ruofeima/code/game-demo/frontend/src/ui/DialogueBox.js && echo 'DialogueBox.transitionToDialogue: OK' || echo 'MISSING'
grep -q 'show-greeting' /Users/ruofeima/code/game-demo/frontend/src/scenes/UIScene.js && echo 'UIScene show-greeting listener: OK' || echo 'MISSING'
```

## Run All Verifications

```bash
# Run all the above checks in sequence
cd /Users/ruofeima/code/game-demo/backend/npc-agent

echo "=== Unit 1: Tool Imports ==="
python -c "from tools import get_player_info, get_player_events, get_available_monsters, get_available_items, get_available_npcs, get_player_tasks, create_task, validate_task; print('OK')"

echo "=== Unit 2: KB Client ==="
python -c "from kb_client import query_knowledge_base; print('OK')"

echo "=== Unit 3: Memory Config ==="
python -c "from memory_config import create_session_manager; assert create_session_manager('p','n') is None; print('OK')"

echo "=== Unit 4: Greeting ==="
python -c "from agent import generate_greeting, _GREETING_TEMPLATES; print(f'OK ({len(_GREETING_TEMPLATES)} templates)')"

echo "=== Frontend Checks ==="
grep -q 'npc_dialogue_greeting' /Users/ruofeima/code/game-demo/frontend/src/scenes/GameScene.js && echo 'Greeting handler: OK'
grep -q 'showGreeting' /Users/ruofeima/code/game-demo/frontend/src/ui/DialogueBox.js && echo 'showGreeting: OK'
grep -q 'pendingDialogue' /Users/ruofeima/code/game-demo/frontend/src/ui/DialogueBox.js && echo 'Pending buffer: OK'
```

- **Expected**: All checks print `OK`
