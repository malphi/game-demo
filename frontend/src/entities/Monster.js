import Phaser from 'phaser';
import { MONSTER_DICT } from '../data/GameData.js';

export default class Monster extends Phaser.GameObjects.Sprite {
  constructor(scene, x, y, monster_id) {
    const template = MONSTER_DICT[monster_id];
    super(scene, x, y, `monster_${monster_id}`);
    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.monster_id = monster_id;
    this.monsterName = template.name;
    this.level = template.level;
    this.hp = template.hp;
    this.max_hp = template.hp;
    this.attackStat = template.attack;
    this.defenseStat = template.defense;
    this.exp_reward = template.exp_reward;
    this.gold_reward = template.gold_reward;
    this.drop_items = template.drop_items || [];
    this.spawnX = x;
    this.spawnY = y;
    this.isDead = false;
    this.respawnTimer = null;

    this.body.setImmovable(true);
    this.setScale(1);
    this.setDepth(5);

    // Create floating name + level label
    this.nameLabel = scene.add
      .text(x, y - template.size / 2 - 6, `Lv.${this.level} ${this.monsterName}`, {
        fontSize: '10px',
        fontFamily: 'Arial',
        color: '#ff6666',
        stroke: '#000000',
        strokeThickness: 2,
      })
      .setOrigin(0.5, 1)
      .setDepth(15);
  }

  takeDamage(amount) {
    this.hp = Math.max(0, this.hp - amount);
    return this.hp;
  }

  resetStats() {
    const template = MONSTER_DICT[this.monster_id];
    this.hp = template.hp;
    this.max_hp = template.hp;
    this.isDead = false;
  }

  kill() {
    this.isDead = true;
    this.setVisible(false);
    this.body.enable = false;
    this.nameLabel.setVisible(false);
  }

  respawn() {
    this.resetStats();
    this.setPosition(this.spawnX, this.spawnY);
    this.setVisible(true);
    this.body.enable = true;
    this.nameLabel.setVisible(true);
    this.nameLabel.setPosition(this.spawnX, this.spawnY - MONSTER_DICT[this.monster_id].size / 2 - 6);
  }

  update() {
    if (!this.isDead) {
      this.nameLabel.setPosition(
        this.x,
        this.y - MONSTER_DICT[this.monster_id].size / 2 - 6
      );
    }
  }

  getState() {
    return {
      monster_id: this.monster_id,
      name: this.monsterName,
      level: this.level,
      hp: this.hp,
      max_hp: this.max_hp,
      attack: this.attackStat,
      defense: this.defenseStat,
      exp_reward: this.exp_reward,
      gold_reward: this.gold_reward,
      drop_items: this.drop_items,
    };
  }

  destroy(fromScene) {
    if (this.nameLabel) {
      this.nameLabel.destroy();
    }
    super.destroy(fromScene);
  }
}
