const { getItem } = require('../models/Item');

/**
 * Inventory management service.
 * All methods mutate the player object directly.
 * The caller is responsible for saving the player afterwards.
 */
const InventoryManager = {
  /**
   * Add an item to the player's inventory.
   * If the item already exists, increase the quantity.
   * @param {object} player - Player data object (mutated in place)
   * @param {string} itemId
   * @param {number} [quantity=1]
   * @returns {{ success: boolean, message?: string }}
   */
  addItem(player, itemId, quantity = 1) {
    const itemDef = getItem(itemId);
    if (!itemDef) {
      return { success: false, message: `Item not found: ${itemId}` };
    }

    if (!player.inventory) {
      player.inventory = [];
    }

    const existing = player.inventory.find((i) => i.item_id === itemId);
    if (existing) {
      existing.quantity += quantity;
    } else {
      player.inventory.push({ item_id: itemId, quantity });
    }

    return { success: true };
  },

  /**
   * Remove an item from the player's inventory.
   * @param {object} player
   * @param {string} itemId
   * @param {number} [quantity=1]
   * @returns {{ success: boolean, message?: string }}
   */
  removeItem(player, itemId, quantity = 1) {
    if (!player.inventory) {
      return { success: false, message: 'Inventory is empty' };
    }

    const existing = player.inventory.find((i) => i.item_id === itemId);
    if (!existing) {
      return { success: false, message: `Item not in inventory: ${itemId}` };
    }

    if (existing.quantity < quantity) {
      return {
        success: false,
        message: `Not enough ${itemId}: have ${existing.quantity}, need ${quantity}`,
      };
    }

    existing.quantity -= quantity;
    if (existing.quantity <= 0) {
      player.inventory = player.inventory.filter((i) => i.item_id !== itemId);
    }

    return { success: true };
  },

  /**
   * Get the quantity of an item in the player's inventory.
   * @param {object} player
   * @param {string} itemId
   * @returns {number}
   */
  getItemQuantity(player, itemId) {
    if (!player.inventory) return 0;
    const item = player.inventory.find((i) => i.item_id === itemId);
    return item ? item.quantity : 0;
  },

  /**
   * Use an item from the player's inventory.
   * Applies the item's effect and removes 1 from inventory.
   * @param {object} player
   * @param {string} itemId
   * @returns {{ success: boolean, message?: string, effect?: object }}
   */
  useItem(player, itemId) {
    const itemDef = getItem(itemId);
    if (!itemDef) {
      return { success: false, message: `Item not found in dictionary: ${itemId}` };
    }

    // Check if the player has the item
    const existing = player.inventory
      ? player.inventory.find((i) => i.item_id === itemId)
      : null;
    if (!existing || existing.quantity <= 0) {
      return { success: false, message: `Item not in inventory: ${itemId}` };
    }

    // Handle gift packs separately
    if (itemDef.type === 'gift_pack') {
      return this.openGiftPack(player, itemId);
    }

    // Handle consumables
    if (itemDef.type === 'consumable') {
      const effect = itemDef.effect || {};

      // HP restore
      if (effect.hp_restore) {
        player.hp = Math.min(player.hp + effect.hp_restore, player.max_hp);
      }

      // Attack boost (simplified: apply immediately, no duration tracking for demo)
      if (effect.attack_boost) {
        player.attack += effect.attack_boost;
      }

      // Defense boost
      if (effect.defense_boost) {
        player.defense += effect.defense_boost;
      }

      // Remove 1 from inventory
      this.removeItem(player, itemId, 1);

      return { success: true, effect, message: `Used ${itemDef.name}` };
    }

    // Handle equipment (simplified equip: apply stat bonuses directly)
    if (itemDef.type === 'equipment') {
      const effect = itemDef.effect || {};

      if (effect.attack) {
        player.attack += effect.attack;
      }
      if (effect.defense) {
        player.defense += effect.defense;
      }
      if (effect.max_hp) {
        player.max_hp += effect.max_hp;
        player.hp += effect.max_hp;
      }

      // Remove 1 from inventory (equipped, consumed from bag)
      this.removeItem(player, itemId, 1);

      return { success: true, effect, message: `Equipped ${itemDef.name}` };
    }

    // Materials cannot be "used"
    if (itemDef.type === 'material') {
      return { success: false, message: `Cannot use material item: ${itemDef.name}` };
    }

    return { success: false, message: `Unknown item type: ${itemDef.type}` };
  },

  /**
   * Open a gift pack and add its contents to the player's inventory.
   * @param {object} player
   * @param {string} itemId - Must be a gift_pack type item
   * @returns {{ success: boolean, message?: string, items_received?: Array }}
   */
  openGiftPack(player, itemId) {
    const itemDef = getItem(itemId);
    if (!itemDef || itemDef.type !== 'gift_pack') {
      return { success: false, message: `Not a gift pack: ${itemId}` };
    }

    // Check inventory
    const existing = player.inventory
      ? player.inventory.find((i) => i.item_id === itemId)
      : null;
    if (!existing || existing.quantity <= 0) {
      return { success: false, message: `Gift pack not in inventory: ${itemId}` };
    }

    const effect = itemDef.effect || {};
    const itemsReceived = [];

    if (effect.contains) {
      // Fixed contents
      for (const entry of effect.contains) {
        const qty = entry.quantity || 1;
        this.addItem(player, entry.item_id, qty);
        itemsReceived.push({ item_id: entry.item_id, quantity: qty });
      }
    } else if (effect.random_one_of) {
      // Random: pick one
      const choices = effect.random_one_of;
      const pick = choices[Math.floor(Math.random() * choices.length)];
      const qty = pick.quantity || 1;
      this.addItem(player, pick.item_id, qty);
      itemsReceived.push({ item_id: pick.item_id, quantity: qty });
    }

    // Remove the gift pack from inventory
    this.removeItem(player, itemId, 1);

    return {
      success: true,
      message: `Opened ${itemDef.name}`,
      items_received: itemsReceived,
    };
  },
};

module.exports = InventoryManager;
