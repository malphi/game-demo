import { ITEM_DICT } from '../data/GameData.js';

export default class InventoryPanel {
  constructor(scene) {
    this.scene = scene;
    this.isVisible = false;
    this.itemTexts = [];
    this.inventory = []; // cached inventory reference
    this.selectedIndex = 0;

    // Panel background
    this.bg = scene.add
      .rectangle(10, 180, 200, 250, 0x000000, 0.7)
      .setDepth(90)
      .setScrollFactor(0)
      .setOrigin(0, 0);

    this.border = scene.add
      .rectangle(10, 180, 200, 250)
      .setStrokeStyle(1, 0x88aaff)
      .setDepth(90)
      .setScrollFactor(0)
      .setOrigin(0, 0);

    this.titleText = scene.add
      .text(20, 185, '-- 背包 --', {
        fontSize: '13px',
        fontFamily: 'Arial',
        color: '#88aaff',
        fontStyle: 'bold',
      })
      .setDepth(91)
      .setScrollFactor(0);

    // Toggle hint
    this.hintText = scene.add
      .text(20, 430, '[I] 背包', {
        fontSize: '10px',
        fontFamily: 'Arial',
        color: '#666666',
      })
      .setDepth(91)
      .setScrollFactor(0);

    // Usage hint (shown when panel is open)
    this.usageHint = scene.add
      .text(20, 0, '↑↓选择  Enter使用', {
        fontSize: '9px',
        fontFamily: 'Arial',
        color: '#666688',
      })
      .setDepth(91)
      .setScrollFactor(0)
      .setVisible(false);

    // Keyboard handlers — stored so we can remove them on destroy
    this.onKeyDown = scene.input.keyboard.on('keydown-DOWN', () => {
      if (!this.isVisible || this.inventory.length === 0) return;
      this.selectedIndex = Math.min(
        this.selectedIndex + 1,
        this.inventory.length - 1
      );
      this.refreshHighlight();
    });

    this.onKeyUp = scene.input.keyboard.on('keydown-UP', () => {
      if (!this.isVisible || this.inventory.length === 0) return;
      this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
      this.refreshHighlight();
    });

    this.onKeyEnter = scene.input.keyboard.on('keydown-ENTER', () => {
      if (!this.isVisible || this.inventory.length === 0) return;
      const item = this.inventory[this.selectedIndex];
      if (!item) return;
      const itemData = ITEM_DICT[item.item_id];
      if (itemData?.type === 'consumable' || itemData?.type === 'equipment') {
        this.scene.events.emit('use-item', item.item_id);
      }
    });

    this.setAllVisible(false);
    this.hintText.setVisible(true);
  }

  update(inventory) {
    // Clear old
    for (const t of this.itemTexts) {
      t.destroy();
    }
    this.itemTexts = [];

    if (!this.isVisible) return;

    this.inventory = inventory || [];

    // Clamp selected index
    if (this.inventory.length === 0) {
      this.selectedIndex = 0;
    } else if (this.selectedIndex >= this.inventory.length) {
      this.selectedIndex = this.inventory.length - 1;
    }

    let yOffset = 205;

    if (this.inventory.length === 0) {
      const empty = this.scene.add
        .text(20, yOffset, '空空如也', {
          fontSize: '11px',
          fontFamily: 'Arial',
          color: '#888888',
        })
        .setDepth(91)
        .setScrollFactor(0);
      this.itemTexts.push(empty);
      this.usageHint.setVisible(false);
      return;
    }

    for (let i = 0; i < this.inventory.length; i++) {
      const item = this.inventory[i];
      const itemData = ITEM_DICT[item.item_id];
      const name = itemData ? itemData.name : item.item_id;
      const typeColor = this.getTypeColor(itemData?.type);
      const isSelected = i === this.selectedIndex;

      const prefix = isSelected ? '▸ ' : '  ';
      const color = isSelected ? '#ffffff' : typeColor;

      const text = this.scene.add
        .text(20, yOffset, `${prefix}${name} x${item.quantity}`, {
          fontSize: '11px',
          fontFamily: 'Arial',
          color: color,
        })
        .setDepth(91)
        .setScrollFactor(0)
        .setInteractive({ useHandCursor: true });

      // Store index for click handling
      const idx = i;

      // Click to select + use consumable/equipment
      text.on('pointerdown', () => {
        this.selectedIndex = idx;
        this.refreshHighlight();
        if (itemData?.type === 'consumable' || itemData?.type === 'equipment') {
          this.scene.events.emit('use-item', item.item_id);
        }
      });

      text.on('pointerover', () => {
        this.selectedIndex = idx;
        this.refreshHighlight();
      });

      this.itemTexts.push(text);
      yOffset += 16;
    }

    // Resize panel
    const panelHeight = Math.max(250, yOffset - 180 + 30);
    this.bg.setSize(200, panelHeight);
    this.border.setSize(200, panelHeight);

    // Position usage hint at bottom of panel
    this.usageHint.setPosition(20, 180 + panelHeight - 15);
    this.usageHint.setVisible(true);
  }

  /** Refresh the highlight colors on all item rows */
  refreshHighlight() {
    for (let i = 0; i < this.itemTexts.length; i++) {
      const item = this.inventory[i];
      if (!item) continue;
      const itemData = ITEM_DICT[item.item_id];
      const typeColor = this.getTypeColor(itemData?.type);
      const isSelected = i === this.selectedIndex;

      const prefix = isSelected ? '▸ ' : '  ';
      const color = isSelected ? '#ffffff' : typeColor;
      const name = itemData ? itemData.name : item.item_id;
      this.itemTexts[i].setText(`${prefix}${name} x${item.quantity}`);
      this.itemTexts[i].setColor(color);
    }
  }

  getTypeColor(type) {
    switch (type) {
      case 'consumable':
        return '#44ff44';
      case 'equipment':
        return '#4488ff';
      case 'material':
        return '#cccccc';
      default:
        return '#aaaaaa';
    }
  }

  show() {
    this.isVisible = true;
    this.selectedIndex = 0;
    this.setAllVisible(true);
  }

  hide() {
    this.isVisible = false;
    this.setAllVisible(false);
    // Keep hint visible
    this.hintText.setVisible(true);
  }

  toggle() {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }

  setAllVisible(visible) {
    this.bg.setVisible(visible);
    this.border.setVisible(visible);
    this.titleText.setVisible(visible);
    this.hintText.setVisible(true); // Always visible
    this.usageHint.setVisible(visible && this.inventory.length > 0);
    for (const t of this.itemTexts) t.setVisible(visible);
  }

  destroy() {
    this.bg.destroy();
    this.border.destroy();
    this.titleText.destroy();
    this.hintText.destroy();
    this.usageHint.destroy();
    for (const t of this.itemTexts) t.destroy();
  }
}
