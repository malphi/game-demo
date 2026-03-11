const { v4: uuidv4 } = require('uuid');

/**
 * Event logging service.
 * Stores player behavior events in memory (array per player).
 * When USE_DYNAMODB=true, also persists to the PlayerEventSummary table.
 */
class EventEmitter {
  constructor() {
    // Map<playerId, Array<event>>
    this.events = new Map();
    this.MAX_EVENTS_PER_PLAYER = 50;

    this.useDynamoDB = process.env.USE_DYNAMODB === 'true';
    this.docClient = null;
    const env = process.env.ENV || '';
    this.tableName = env ? `PlayerEventSummary-${env}` : 'PlayerEventSummary';

    if (this.useDynamoDB) {
      this._initDynamoDB();
    }
  }

  _initDynamoDB() {
    try {
      const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
      const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
      const config = { region: process.env.AWS_REGION || 'us-west-2' };
      if (process.env.DYNAMODB_ENDPOINT) {
        config.endpoint = process.env.DYNAMODB_ENDPOINT;
      }
      const client = new DynamoDBClient(config);
      this.docClient = DynamoDBDocumentClient.from(client);
    } catch (err) {
      console.error('EventEmitter: Failed to init DynamoDB client:', err.message);
      this.useDynamoDB = false;
    }
  }

  /**
   * Log a player behavior event.
   * @param {string} playerId
   * @param {string} eventType - e.g. battle_victory, battle_defeat, task_completed, item_acquired, item_used, level_up
   * @param {string} targetId - Related target (monster_id, item_id, npc_id, task_id)
   * @param {string} result - 'success' or 'failure'
   * @param {object} details - Additional event data
   * @returns {object} The created event
   */
  logEvent(playerId, eventType, targetId, result, details = {}) {
    if (!this.events.has(playerId)) {
      this.events.set(playerId, []);
    }

    const event = {
      player_id: playerId,
      event_id: uuidv4(),
      event_type: eventType,
      target_id: targetId,
      result: result,
      details: details,
      timestamp: new Date().toISOString(),
    };

    const playerEvents = this.events.get(playerId);
    playerEvents.push(event);

    // Keep only the most recent MAX_EVENTS_PER_PLAYER events
    if (playerEvents.length > this.MAX_EVENTS_PER_PLAYER) {
      playerEvents.splice(0, playerEvents.length - this.MAX_EVENTS_PER_PLAYER);
    }

    console.log(`[EVENT] ${eventType} | player=${playerId} target=${targetId} result=${result}`, JSON.stringify(details));

    // Persist to DynamoDB (fire-and-forget, don't block game logic)
    if (this.useDynamoDB && this.docClient) {
      const { PutCommand } = require('@aws-sdk/lib-dynamodb');
      this.docClient.send(
        new PutCommand({ TableName: this.tableName, Item: event })
      ).catch((err) => {
        console.error(`EventEmitter: Failed to write event to DynamoDB: ${err.message}`);
      });
    }

    return event;
  }

  /**
   * Get the most recent events for a player.
   * @param {string} playerId
   * @param {number} [limit=20] - Max events to return
   * @returns {Array} Events sorted newest first
   */
  getRecentEvents(playerId, limit = 20) {
    const playerEvents = this.events.get(playerId);
    if (!playerEvents || playerEvents.length === 0) {
      return [];
    }
    // Return newest first, limited
    return playerEvents.slice(-limit).reverse();
  }

  /**
   * Get all events of a specific type for a player.
   * @param {string} playerId
   * @param {string} eventType
   * @returns {Array}
   */
  getEventsByType(playerId, eventType) {
    const playerEvents = this.events.get(playerId);
    if (!playerEvents) return [];
    return playerEvents.filter((e) => e.event_type === eventType);
  }
}

// Singleton instance
const eventEmitter = new EventEmitter();

module.exports = eventEmitter;
