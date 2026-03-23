import Phaser from 'phaser';

export default class RemotePlayer extends Phaser.GameObjects.Sprite {
  constructor(scene, { player_id, x, y, character, name }) {
    const textureKey = character === 'player_2' ? 'player_2' : 'player';
    super(scene, x, y, textureKey);

    scene.add.existing(this);
    this.player_id = player_id;
    this.setScale(2);
    this.setDepth(9);
    this.setAlpha(0.85);

    // Name label
    this.nameLabel = scene.add
      .text(x, y - 20, name || player_id, {
        fontSize: '10px',
        color: '#aaddff',
        stroke: '#000',
        strokeThickness: 2,
      })
      .setOrigin(0.5)
      .setDepth(9);
  }

  updatePosition(x, y) {
    // Smooth tween to new position
    this.scene.tweens.add({
      targets: [this, this.nameLabel],
      duration: 100,
      overwrite: true,
      x: { value: x, ease: 'Linear' },
    });
    this.scene.tweens.add({
      targets: this,
      duration: 100,
      overwrite: true,
      y: { value: y, ease: 'Linear' },
    });
    this.scene.tweens.add({
      targets: this.nameLabel,
      duration: 100,
      overwrite: true,
      y: { value: y - 20, ease: 'Linear' },
    });
  }

  destroy() {
    if (this.nameLabel) {
      this.nameLabel.destroy();
    }
    super.destroy();
  }
}
