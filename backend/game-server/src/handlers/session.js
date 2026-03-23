const playerDataService = require('../services/PlayerDataService');
const taskPreGenerator = require('../services/TaskPreGenerator');

/**
 * Session management handlers.
 * POST /api/game/start - Create or resume a game session
 * POST /api/game/save  - Save current game state
 */

/**
 * Start a game session.
 * If player_id is provided, resume that player's session.
 * Otherwise, create a new player.
 * Body: { player_id?: string, name?: string }
 */
async function handleGameStart(req, res) {
  try {
    const { player_id, name } = req.body || {};

    let player;

    if (player_id) {
      // Resume existing player, or create with that ID if not found
      player = await playerDataService.getPlayer(player_id);
      if (!player) {
        player = await playerDataService.createPlayer(name, player_id);
      }
    } else {
      // Create new player
      player = await playerDataService.createPlayer(name);
    }

    // Trigger async pre-generation on login (generate first task for new players)
    taskPreGenerator.triggerPreGeneration(player.player_id, 'player_login', {
      is_new: !player_id || !player.completed_tasks || player.completed_tasks.length === 0,
      player_level: player.level,
    });

    return res.json({
      success: true,
      player,
      message: player_id ? 'Session resumed' : 'New game started',
    });
  } catch (err) {
    console.error('Error in handleGameStart:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
}

/**
 * Save the current game state.
 * Body: { player_id: string, position_x?: number, position_y?: number, hp?: number }
 */
async function handleGameSave(req, res) {
  try {
    const { player_id, ...updates } = req.body || {};

    if (!player_id) {
      return res.status(400).json({
        success: false,
        message: 'player_id is required',
      });
    }

    const player = await playerDataService.getPlayer(player_id);
    if (!player) {
      return res.status(404).json({
        success: false,
        message: `Player not found: ${player_id}`,
      });
    }

    // Only allow saving certain fields from the client
    const allowedFields = ['position_x', 'position_y'];
    const safeUpdates = {};
    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        safeUpdates[field] = updates[field];
      }
    }

    const updated = await playerDataService.updatePlayer(player_id, safeUpdates);

    return res.json({
      success: true,
      player: updated,
      message: 'Game saved',
    });
  } catch (err) {
    console.error('Error in handleGameSave:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = {
  handleGameStart,
  handleGameSave,
};
