# Integration Test Instructions

## Purpose

Test the end-to-end interactions between all 4 units to ensure they work together correctly in the NPC dialogue flow.

## Prerequisites

- All services running (see build-instructions.md)
- DynamoDB tables created and seeded
- AWS credentials configured
- Environment variables set (BEDROCK_KB_ID, AGENTCORE_MEMORY_ID, AGENTCORE_RUNTIME_ARN)

## Test Scenarios

### Scenario 1: NPC Agent Local — Full Dialogue Flow (Units 1+2+3)

**Tests**: MCP Tools (Unit 1) + Knowledge Base (Unit 2) + Memory (Unit 3)

```bash
# Start NPC Agent locally
cd /Users/ruofeima/code/game-demo/backend/npc-agent
python agent.py &

# Wait for startup
sleep 3

# Test greeting endpoint (Unit 4)
curl -s -X POST http://localhost:8090/agent/greeting \
  -H "Content-Type: application/json" \
  -d '{"player_id": "player_001", "npc_id": "npc_001"}' | python -m json.tool

# Test full dialogue endpoint (Units 1+2+3)
curl -s -X POST http://localhost:8090/agent/dialogue \
  -H "Content-Type: application/json" \
  -d '{"player_id": "player_001", "npc_id": "npc_001"}' | python -m json.tool
```

**Expected Results**:
- Greeting: Returns `{"greeting": "...", "npc_id": "npc_001", "npc_name": "...", "player_id": "player_001"}` in < 500ms
- Dialogue: Returns `{"dialogue": "...", "task": {...}, "debug_log": [...]}` with:
  - `debug_log` shows tool_call entries for `get_player_info`, `get_available_monsters`, `create_task`, etc. (Unit 1)
  - KB-sourced data used in monster/item queries (Unit 2, visible in tool results)
  - Memory context loaded if AGENTCORE_MEMORY_ID is set (Unit 3)

### Scenario 2: Greeting Response Time (Unit 4)

**Tests**: Greeting latency < 500ms (target: ~100ms)

```bash
# Run 5 greeting requests and measure response time
for i in $(seq 1 5); do
  start=$(python3 -c "import time; print(int(time.time()*1000))")
  curl -s -X POST http://localhost:8090/agent/greeting \
    -H "Content-Type: application/json" \
    -d '{"player_id": "player_001", "npc_id": "npc_001"}' > /dev/null
  end=$(python3 -c "import time; print(int(time.time()*1000))")
  echo "Request $i: $((end - start))ms"
done
```

**Expected**: Each request < 500ms (most < 200ms)

### Scenario 3: Game Server — Parallel Greeting + Dialogue (Unit 4 + Full Stack)

**Tests**: Game Server sends `npc_dialogue_greeting` before `npc_dialogue_response`

**Manual WebSocket Test**:
1. Open browser to `http://localhost:5173`
2. Open browser DevTools Console
3. Walk player to an NPC (e.g., village elder)
4. Observe WebSocket messages in Network tab:
   - First message: `{"type": "npc_dialogue_greeting", "greeting": "...", ...}`
   - Second message: `{"type": "npc_dialogue_response", "dialogue": "...", "task": {...}, ...}`
5. In the game UI:
   - NPC greeting appears immediately with typewriter effect
   - After greeting finishes, full dialogue with task appears seamlessly

**Expected Timing**:
- Greeting message arrives: < 500ms after dialogue start
- Full dialogue message arrives: ~2-3s after dialogue start
- Player perceives no waiting (greeting fills the gap)

### Scenario 4: Existing Task — Skip AgentCore (Game Server Logic)

**Tests**: Game Server returns cached dialogue when player has active task

1. Complete Scenario 3 and accept a task
2. Walk to the same NPC again
3. Observe:
   - No AgentCore call (no greeting + dialogue)
   - Immediate response: `"你还没完成我交给你的任务「...」呢！"`

### Scenario 5: Memory Persistence (Unit 3)

**Tests**: Second dialogue with same NPC references first conversation

1. Complete Scenario 3 (first dialogue with NPC)
2. Complete the assigned task
3. Walk to the same NPC again
4. Observe the LLM dialogue — it should reference previous interaction context
   - e.g., "上次你完成了打怪任务，这次试试..." or similar

**Note**: Requires AGENTCORE_MEMORY_ID to be configured. Without it, each dialogue is stateless.

### Scenario 6: Knowledge Base Fallback (Unit 2)

**Tests**: Tools work even without KB (DynamoDB fallback)

```bash
# Temporarily unset BEDROCK_KB_ID and test
BEDROCK_KB_ID="" python -c "
import os
os.environ['BEDROCK_KB_ID'] = ''
from tools.get_monsters import get_available_monsters
result = get_available_monsters()
print(type(result), '- items:', len(result) if isinstance(result, list) else 'string response')
"
```

**Expected**: Returns monster data from DynamoDB scan (fallback path)

## Cleanup

```bash
# Stop local NPC Agent
kill %1 2>/dev/null

# Or find and kill by port
lsof -ti:8090 | xargs kill 2>/dev/null
lsof -ti:3000 | xargs kill 2>/dev/null
```
