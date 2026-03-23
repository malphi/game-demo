# Performance Test Instructions

## Purpose

Validate that latency optimization (Unit 4) achieves the target: perceived latency from ~3s to <1s.

## Performance Requirements

| Metric | Target | Baseline (Before) |
|--------|--------|-------------------|
| Greeting response time | < 500ms | N/A (new) |
| LLM dialogue total time | < 3s | ~3s |
| Perceived latency (first visible text) | < 1s | ~3s |
| Prompt caching hit rate | > 80% (after warmup) | 0% |

## Test 1: Greeting Latency

```bash
cd /Users/ruofeima/code/game-demo/backend/npc-agent
python agent.py &
sleep 3

echo "=== Greeting Latency (10 requests) ==="
for i in $(seq 1 10); do
  start=$(python3 -c "import time; print(int(time.time()*1000))")
  curl -s -X POST http://localhost:8090/agent/greeting \
    -H "Content-Type: application/json" \
    -d "{\"player_id\": \"player_001\", \"npc_id\": \"npc_00$((i % 4 + 1))\"}" > /dev/null
  end=$(python3 -c "import time; print(int(time.time()*1000))")
  echo "  Request $i (npc_00$((i % 4 + 1))): $((end - start))ms"
done
```

**Pass Criteria**: Average < 300ms, P99 < 500ms

## Test 2: Full Dialogue Latency (with Prompt Caching)

```bash
echo "=== Dialogue Latency (5 requests, same NPC for caching) ==="
for i in $(seq 1 5); do
  start=$(python3 -c "import time; print(int(time.time()*1000))")
  result=$(curl -s -X POST http://localhost:8090/agent/dialogue \
    -H "Content-Type: application/json" \
    -d "{\"player_id\": \"player_00$i\", \"npc_id\": \"npc_001\"}")
  end=$(python3 -c "import time; print(int(time.time()*1000))")

  # Extract timing from debug_log
  timing=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); t=[x for x in d.get('debug_log',[]) if x.get('type')=='timing']; print(t[0]['total_ms'] if t else 'N/A')")
  echo "  Request $i: wall=$((end - start))ms, agent_reported=${timing}ms"
done
```

**Pass Criteria**:
- First request: < 5s (cold start, no cache)
- Subsequent requests: < 3s (prompt caching active)
- Requests 3-5 should show ~30-50% improvement over request 1

## Test 3: Parallel Greeting + Dialogue Timing

```bash
echo "=== Parallel Greeting + Dialogue ==="
for i in $(seq 1 3); do
  overall_start=$(python3 -c "import time; print(time.time())")

  # Fire both in parallel (simulating Game Server behavior)
  greeting_start=$(python3 -c "import time; print(time.time())")
  curl -s -X POST http://localhost:8090/agent/greeting \
    -H "Content-Type: application/json" \
    -d "{\"player_id\": \"player_00$i\", \"npc_id\": \"npc_001\"}" > /tmp/greeting_result.json &

  dialogue_start=$(python3 -c "import time; print(time.time())")
  curl -s -X POST http://localhost:8090/agent/dialogue \
    -H "Content-Type: application/json" \
    -d "{\"player_id\": \"player_00$i\", \"npc_id\": \"npc_001\"}" > /tmp/dialogue_result.json &

  wait
  overall_end=$(python3 -c "import time; print(time.time())")

  greeting_ms=$(python3 -c "
import json
r = json.load(open('/tmp/greeting_result.json'))
print('OK' if r.get('greeting') else 'FAIL')
")

  dialogue_ms=$(python3 -c "
import json
r = json.load(open('/tmp/dialogue_result.json'))
t = [x for x in r.get('debug_log',[]) if x.get('type')=='timing']
print(t[0]['total_ms'] if t else 'N/A')
")

  total=$(python3 -c "print(int(($overall_end - $overall_start) * 1000))")
  echo "  Run $i: total=${total}ms, greeting=${greeting_ms}, dialogue_agent=${dialogue_ms}ms"
done
```

**Pass Criteria**: Greeting completes before dialogue, total wall time ~ max(greeting, dialogue)

## Test 4: Connection Warmup Effect

```bash
echo "=== Connection Warmup (module-level BedrockModel) ==="
echo "First import (includes connection setup):"
time python3 -c "from agent import _bedrock_model; print('Model loaded:', _bedrock_model.config['model_id'])"

echo "Second import (should be instant from module cache):"
time python3 -c "from agent import _bedrock_model; print('Model loaded:', _bedrock_model.config['model_id'])"
```

**Pass Criteria**: Both imports succeed. In production (long-running process), second+ requests skip connection setup entirely.

## Cleanup

```bash
kill %1 2>/dev/null
rm -f /tmp/greeting_result.json /tmp/dialogue_result.json
```

## Results Analysis

After running all tests, fill in:

| Metric | Result | Target | Status |
|--------|--------|--------|--------|
| Greeting avg latency | ___ms | < 300ms | |
| Dialogue cold start | ___ms | < 5s | |
| Dialogue warm (cached) | ___ms | < 3s | |
| Perceived latency | ___ms | < 1s | |
