const eventEmitter = require('./EventEmitter');

/**
 * Pre-generates NPC tasks asynchronously on game events.
 * When a player triggers an event (battle, login, item use, etc.),
 * the LLM is called in the background to prepare a task + dialogue.
 * When the player later talks to an NPC, the cached result is served instantly.
 */
class TaskPreGenerator {
  constructor() {
    // Map<playerId, { task, dialogue, npc_id, npc_name, debug_log, generated_at, event_summary }>
    this.cache = new Map();
    // Map<playerId, Promise> — tracks in-flight generation to avoid duplicates
    this.pending = new Map();
  }

  /**
   * Trigger async pre-generation for a player based on a game event.
   * Non-blocking — fires and forgets; result lands in cache.
   *
   * @param {string} playerId
   * @param {string} eventType - e.g. 'player_login', 'battle_victory', 'task_completed', 'item_used'
   * @param {object} eventDetails - event-specific data (monster_id, item_id, etc.)
   */
  triggerPreGeneration(playerId, eventType, eventDetails = {}) {
    // Skip if already generating for this player
    if (this.pending.has(playerId)) {
      console.log(`[PreGen] Skipping — already generating for player=${playerId}`);
      return;
    }

    console.log(`[PreGen] Triggering pre-generation: player=${playerId}, event=${eventType}`);

    const promise = this._callAgentCore(playerId, eventType, eventDetails)
      .then((result) => {
        if (result && result.dialogue) {
          this.cache.set(playerId, {
            ...result,
            generated_at: Date.now(),
            event_type: eventType,
            event_details: eventDetails,
          });
          console.log(`[PreGen] Cached result for player=${playerId}, npc=${result.npc_id}, hasTask=${!!result.task}`);
        } else {
          console.log(`[PreGen] No result for player=${playerId} (event=${eventType})`);
        }
      })
      .catch((err) => {
        console.error(`[PreGen] Failed for player=${playerId}: ${err.message}`);
      })
      .finally(() => {
        this.pending.delete(playerId);
      });

    this.pending.set(playerId, promise);
  }

  /**
   * Retrieve and consume a pre-generated result for a player+NPC.
   * Returns null if no cached result or NPC doesn't match.
   *
   * @param {string} playerId
   * @param {string} npcId
   * @returns {object|null} { dialogue, task, npc_id, npc_name, debug_log, event_summary }
   */
  consumePreGenerated(playerId, npcId) {
    const cached = this.cache.get(playerId);
    if (!cached) return null;

    // Only serve if the cached result targets this NPC
    if (cached.npc_id && cached.npc_id !== npcId) return null;

    // Expire after 5 minutes
    if (Date.now() - cached.generated_at > 5 * 60 * 1000) {
      this.cache.delete(playerId);
      console.log(`[PreGen] Expired cached result for player=${playerId}`);
      return null;
    }

    // Consume (one-shot)
    this.cache.delete(playerId);
    console.log(`[PreGen] Serving cached result for player=${playerId}, npc=${npcId}`);
    return cached;
  }

  /**
   * Check if there's a pending generation for a player.
   * If so, the caller can await it.
   */
  getPendingPromise(playerId) {
    return this.pending.get(playerId) || null;
  }

  /**
   * Call AgentCore with pre_generate action.
   */
  async _callAgentCore(playerId, eventType, eventDetails) {
    const { BedrockAgentCoreClient, InvokeAgentRuntimeCommand } = require('@aws-sdk/client-bedrock-agentcore');
    const client = new BedrockAgentCoreClient({
      region: process.env.AWS_REGION || 'us-west-2',
    });

    const payload = JSON.stringify({
      player_id: playerId,
      npc_id: null, // Agent decides which NPC
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
    console.log(`[PreGen] Invoking AgentCore for player=${playerId}, event=${eventType}`);
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
    this.cache.delete(playerId);
    this.pending.delete(playerId);
  }
}

// Singleton
const taskPreGenerator = new TaskPreGenerator();
module.exports = taskPreGenerator;
