import Phaser from 'phaser';

export default class NPC extends Phaser.GameObjects.Sprite {
  constructor(scene, npcData) {
    super(scene, npcData.position_x, npcData.position_y, `npc_${npcData.npc_id}`);
    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.npc_id = npcData.npc_id;
    this.npcName = npcData.name;
    this.role = npcData.role;
    this.personality = npcData.personality;

    this.body.setImmovable(true);
    this.setScale(2);
    // Shrink physics body so dialogue only triggers at close range
    this.body.setSize(16, 16);
    this.body.setOffset((this.width - 16) / 2, (this.height - 16) / 2);
    this.setDepth(5);

    // Create floating name label
    this.nameLabel = scene.add
      .text(
        npcData.position_x,
        npcData.position_y - 35,
        this.npcName,
        {
          fontSize: '11px',
          fontFamily: 'Arial',
          color: '#88ccff',
          stroke: '#000000',
          strokeThickness: 2,
        }
      )
      .setOrigin(0.5, 1)
      .setDepth(15);
  }

  update() {
    this.nameLabel.setPosition(this.x, this.y - 35);
  }

  destroy(fromScene) {
    if (this.nameLabel) this.nameLabel.destroy();
    super.destroy(fromScene);
  }
}
