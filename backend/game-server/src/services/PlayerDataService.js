const { createPlayerData } = require('../models/Player');

/**
 * Player data access layer.
 * In-memory mode: uses a Map.
 * DynamoDB mode: uses @aws-sdk/lib-dynamodb (when USE_DYNAMODB=true).
 */
class PlayerDataService {
  constructor() {
    this.useDynamoDB = process.env.USE_DYNAMODB === 'true';
    // In-memory store
    this.players = new Map();
    this.docClient = null;
    const env = process.env.ENV || '';
    this.tableName = env ? `Players-${env}` : 'Players';

    if (this.useDynamoDB) {
      this._initDynamoDB();
    }
  }

  _initDynamoDB() {
    try {
      const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
      const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
      const config = {
        region: process.env.AWS_REGION || 'us-west-2',
      };
      if (process.env.DYNAMODB_ENDPOINT) {
        config.endpoint = process.env.DYNAMODB_ENDPOINT;
      }
      const client = new DynamoDBClient(config);
      this.docClient = DynamoDBDocumentClient.from(client);
    } catch (err) {
      console.error('Failed to initialize DynamoDB client:', err.message);
      console.log('Falling back to in-memory storage.');
      this.useDynamoDB = false;
    }
  }

  /**
   * Create a new player.
   * @param {string} [name] - Player name
   * @returns {Promise<object>} The created player data
   */
  async createPlayer(name, playerId) {
    const player = createPlayerData(name, playerId);

    if (this.useDynamoDB) {
      const { PutCommand } = require('@aws-sdk/lib-dynamodb');
      await this.docClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: player,
        })
      );
    } else {
      this.players.set(player.player_id, player);
    }

    return player;
  }

  /**
   * Get player by ID.
   * @param {string} playerId
   * @returns {Promise<object|null>}
   */
  async getPlayer(playerId) {
    if (this.useDynamoDB) {
      const { GetCommand } = require('@aws-sdk/lib-dynamodb');
      const result = await this.docClient.send(
        new GetCommand({
          TableName: this.tableName,
          Key: { player_id: playerId },
        })
      );
      return result.Item || null;
    } else {
      return this.players.get(playerId) || null;
    }
  }

  /**
   * Update player fields.
   * @param {string} playerId
   * @param {object} updates - Fields to update
   * @returns {Promise<object|null>} Updated player, or null if not found
   */
  async updatePlayer(playerId, updates) {
    if (this.useDynamoDB) {
      const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');

      // Build update expression
      const expressionParts = [];
      const expressionNames = {};
      const expressionValues = {};

      // Always update updated_at
      updates.updated_at = new Date().toISOString();

      for (const [key, value] of Object.entries(updates)) {
        const nameAlias = `#${key}`;
        const valueAlias = `:${key}`;
        expressionParts.push(`${nameAlias} = ${valueAlias}`);
        expressionNames[nameAlias] = key;
        expressionValues[valueAlias] = value;
      }

      const result = await this.docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { player_id: playerId },
          UpdateExpression: `SET ${expressionParts.join(', ')}`,
          ExpressionAttributeNames: expressionNames,
          ExpressionAttributeValues: expressionValues,
          ReturnValues: 'ALL_NEW',
        })
      );
      return result.Attributes || null;
    } else {
      const player = this.players.get(playerId);
      if (!player) return null;

      Object.assign(player, updates, { updated_at: new Date().toISOString() });
      return player;
    }
  }

  /**
   * Save the full player object (overwrite).
   * Useful after battle or task completion where many fields change.
   * @param {object} player
   * @returns {Promise<object>}
   */
  async savePlayer(player) {
    player.updated_at = new Date().toISOString();

    if (this.useDynamoDB) {
      const { PutCommand } = require('@aws-sdk/lib-dynamodb');
      await this.docClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: player,
        })
      );
    } else {
      this.players.set(player.player_id, player);
    }
    return player;
  }
}

// Singleton
const playerDataService = new PlayerDataService();

module.exports = playerDataService;
