# Requirements V2 - Bug Fixes and Optimization

## Intent Analysis
- **User Request**: Fix 3 specific issues in the game demo
- **Request Type**: Bug Fix + Enhancement
- **Scope**: Multiple Components (NPC Agent prompt, console log labels, latency optimization)
- **Complexity**: Moderate
- **Request Clarity**: Clear - all 3 issues are well-defined

## Functional Requirements

### FR-1: Filter LLM Internal Text from Dialogue Box
- **Issue**: The dialogue box displays LLM internal reasoning text like "任务创建成功" which should not be shown to the player
- **Root Cause**: The NPC Agent's system prompt instructs LLM to create tasks and provide dialogue, but the LLM mixes task creation status messages into its response text
- **Solution**: Modify the system prompt to instruct the LLM to ONLY output in-character NPC dialogue (no meta-text), and/or add post-processing to strip non-dialogue text from the response
- **Acceptance Criteria**: Dialogue box only shows in-character NPC speech, no system/meta messages

### FR-2: Console Log Labels and Tool Call Optimization
- **Issue A**: Tool calls in the Agent Console show as green "get_player_info" without context - need [MCP Tool] prefix
- **Issue B**: Tool calls are inefficient:
  - `get_player_info` should only be called when Memory is OFF; when Memory is ON, player info comes from short-term memory
  - `get_player_events` should only be called when long-term Memory doesn't have event history
  - `get_player_tasks` and `get_available_npcs` data is in the Knowledge Base (KB) - should use KB retrieval instead of MCP tool calls
- **Solution**:
  - Add [MCP Tool] label to tool call entries in Agent Console
  - Modify system prompt to guide LLM on when to use tools vs memory vs KB
  - Potentially restructure tools to check memory/KB first before querying DynamoDB
- **Acceptance Criteria**:
  - Console shows `[MCP Tool] get_player_info` format
  - When Memory is ON: player info and events come from memory, not tool calls
  - Tasks and NPC data come from KB retrieval, not MCP tool calls

### FR-3: Latency Reduction
- **Issue**: Despite previous latency optimization (greeting + parallel calls), the overall response time is still too high (~10s based on test invocation)
- **Root Cause**: The LLM makes multiple sequential tool calls (get_player_info, get_player_events, get_player_tasks, get_available_monsters, create_task) which adds latency per round-trip
- **Solution Options**:
  - Reduce tool call round-trips by pre-fetching data and injecting into the user message (so LLM doesn't need to call tools for reads)
  - Only require LLM to call write tools (create_task, validate_task)
  - Use prompt caching more effectively
  - Reduce token count in system prompt and tool descriptions
- **Acceptance Criteria**: NPC dialogue response time reduced to under 5 seconds

## Non-Functional Requirements
- No new infrastructure changes needed
- No database schema changes
- Changes are backwards compatible
- Memory OFF mode must still work correctly

## Component Impact
| Component | Change Type | Files |
|---|---|---|
| NPC Agent (Python) | System prompt + agent logic | agent.py, prompts/npc_system_prompt.txt |
| Frontend (JS) | Console log label format | GameScene.js |
| Game Server (JS) | No changes expected | - |
