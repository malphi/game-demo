const eventEmitter = require('./EventEmitter');

/**
 * Pre-generates NPC tasks asynchronously on game events.
 * When a player triggers an event (battle, login, item use, etc.),
 * the LLM is called in the background for the Elder NPC only (for speed).
 * Other NPCs generate tasks on-demand when the player talks to them.
 */

// Only pre-generate for Elder NPC to keep latency low
const EVENT_NPC_MAPPING = {
  player_login: ['npc_elder'],
  battle_victory: ['npc_elder'],
  battle_defeat: ['npc_elder'],
  task_completed: ['npc_elder'],
  item_used: ['npc_elder'],
  item_acquired: ['npc_elder'],
  level_up: ['npc_elder'],
};

class TaskPreGenerator {
  constructor() {
    // Map<"playerId_npcId", { task, dialogue, npc_id, npc_name, debug_log, generated_at, event_type }>
    this.cache = new Map();
    // Map<"playerId_npcId", Promise> — tracks in-flight generation per player+NPC
    this.pending = new Map();
  }

  /**
   * Trigger async pre-generation for a player for relevant NPCs based on event type.
   * Non-blocking — fires and forgets; results land in cache per NPC.
   *
   * @param {string} playerId
   * @param {string} eventType - e.g. 'player_login', 'battle_victory', 'task_completed'
   * @param {object} eventDetails - event-specific data
   * @param {WebSocket} [ws] - optional WebSocket to notify frontend
   */
  triggerPreGeneration(playerId, eventType, eventDetails = {}, ws = null) {
    const targetNPCs = EVENT_NPC_MAPPING[eventType] || ['npc_elder'];

    console.log(`[PreGen] Triggering pre-generation for ${targetNPCs.length} NPCs [${targetNPCs.join(', ')}]: player=${playerId}, event=${eventType}`);

    // Notify frontend that pre-generation has started
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({
        type: 'pre_generation_started',
        event_type: eventType,
        event_details: eventDetails,
        npc_ids: targetNPCs,
      }));
    }

    for (const npcId of targetNPCs) {
      const cacheKey = `${playerId}_${npcId}`;

      // Skip if already generating for this player+NPC
      if (this.pending.has(cacheKey)) {
        console.log(`[PreGen] Skipping ${npcId} — already generating for player=${playerId}`);
        continue;
      }

      // Skip if already cached for this player+NPC
      if (this.cache.has(cacheKey)) {
        console.log(`[PreGen] Skipping ${npcId} — already cached for player=${playerId}`);
        continue;
      }

      const promise = this._callAgentCore(playerId, npcId, eventType, eventDetails)
        .then((result) => {
          if (result && result.dialogue) {
            this.cache.set(cacheKey, {
              ...result,
              generated_at: Date.now(),
              event_type: eventType,
              event_details: eventDetails,
            });
            console.log(`[PreGen] Cached result for player=${playerId}, npc=${npcId}, hasTask=${!!result.task}`);
            if (ws && ws.readyState === 1) {
              ws.send(JSON.stringify({
                type: 'pre_generation_complete',
                event_type: eventType,
                npc_id: result.npc_id || npcId,
                npc_name: result.npc_name,
                has_task: !!result.task,
                debug_log: result.debug_log || [],
              }));
            }
          } else {
            console.log(`[PreGen] No result for player=${playerId}, npc=${npcId} (skipped or has active task)`);
            if (ws && ws.readyState === 1) {
              ws.send(JSON.stringify({
                type: 'pre_generation_skipped',
                event_type: eventType,
                npc_id: npcId,
                reason: 'NPC已有活跃任务或无需生成',
              }));
            }
          }
        })
        .catch((err) => {
          console.error(`[PreGen] Failed for player=${playerId}, npc=${npcId}: ${err.message}`);
        })
        .finally(() => {
          this.pending.delete(cacheKey);
        });

      this.pending.set(cacheKey, promise);
    }
  }

  /**
   * Retrieve and consume a pre-generated result for a player+NPC.
   * Returns null if no cached result.
   */
  consumePreGenerated(playerId, npcId) {
    const cacheKey = `${playerId}_${npcId}`;
    const cached = this.cache.get(cacheKey);
    if (!cached) return null;

    // Expire after 5 minutes
    if (Date.now() - cached.generated_at > 5 * 60 * 1000) {
      this.cache.delete(cacheKey);
      console.log(`[PreGen] Expired cached result for player=${playerId}, npc=${npcId}`);
      return null;
    }

    // Consume (one-shot)
    this.cache.delete(cacheKey);
    console.log(`[PreGen] Serving cached result for player=${playerId}, npc=${npcId}`);
    return cached;
  }

  /**
   * Check if there's a pending generation for a player+NPC.
   */
  getPendingPromise(playerId, npcId) {
    if (npcId) {
      return this.pending.get(`${playerId}_${npcId}`) || null;
    }
    return null;
  }

  /**
   * Call AgentCore with pre_generate action for a specific NPC.
   */
  async _callAgentCore(playerId, npcId, eventType, eventDetails) {
    const { BedrockAgentCoreClient, InvokeAgentRuntimeCommand } = require('@aws-sdk/client-bedrock-agentcore');
    const client = new BedrockAgentCoreClient({
      region: process.env.AWS_REGION || 'us-west-2',
    });

    const payload = JSON.stringify({
      player_id: playerId,
      npc_id: npcId,
      action: 'pre_generate',
      event_type: eventType,
      event_details: eventDetails,
    });

    const input = {
      agentRuntimeArn: process.env.AGENTCORE_RUNTIME_ARN,
      contentType: 'application/json',
      accept: 'application/json',
      payload: Buffer.from(payload),
    };
    if (process.env.AGENTCORE_ENDPOINT_NAME) {
      input.qualifier = process.env.AGENTCORE_ENDPOINT_NAME;
    }

    const command = new InvokeAgentRuntimeCommand(input);
    console.log(`[PreGen] Invoking AgentCore for player=${playerId}, npc=${npcId}, event=${eventType}`);
    const response = await client.send(command);

    // Read streaming response
    const chunks = [];
    if (response.response && typeof response.response[Symbol.asyncIterator] === 'function') {
      for await (const chunk of response.response) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
    } else if (Buffer.isBuffer(response.response)) {
      chunks.push(response.response);
    } else if (typeof response.response === 'string') {
      chunks.push(Buffer.from(response.response));
    }

    const body = chunks.length > 0 ? Buffer.concat(chunks).toString('utf-8') : '';
    if (!body) return null;

    let result = JSON.parse(body);
    if (typeof result === 'string') {
      result = JSON.parse(result);
    }
    return result;
  }

  /**
   * Clear cache for a player (e.g. on logout).
   */
  clearPlayer(playerId) {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${playerId}_`)) {
        this.cache.delete(key);
      }
    }
    for (const key of this.pending.keys()) {
      if (key.startsWith(`${playerId}_`)) {
        this.pending.delete(key);
      }
    }
  }
}

// Singleton
const taskPreGenerator = new TaskPreGenerator();
module.exports = taskPreGenerator;
