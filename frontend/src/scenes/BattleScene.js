import Phaser from 'phaser';

export default class BattleScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BattleScene' });
  }

  init(data) {
    this.playerEntity = data.player;
    this.monsterEntity = data.monster;
    this.gameScene = data.gameScene;
    this.battleLog = [];
    this.battleOver = false;
    this.roundCount = 0;
  }

  create() {
    const cx = 400;
    const cy = 300;

    // Semi-transparent overlay background
    this.overlay = this.add
      .rectangle(cx, cy, 800, 600, 0x000000, 0.75)
      .setDepth(0);

    // Battle frame
    this.frame = this.add
      .rectangle(cx, cy, 700, 400, 0x111122, 0.95)
      .setDepth(1);
    this.frameBorder = this.add
      .rectangle(cx, cy, 700, 400)
      .setStrokeStyle(2, 0x4466aa)
      .setDepth(1);

    // Title
    this.add
      .text(cx, cy - 180, '-- 战 斗 --', {
        fontSize: '22px',
        fontFamily: 'Arial',
        color: '#ff6644',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(2);

    // Player section (left side)
    this.createPlayerSection(cx - 230, cy - 110);

    // Monster section (right side)
    this.createMonsterSection(cx + 230, cy - 110);

    // VS text
    this.add
      .text(cx, cy - 90, 'VS', {
        fontSize: '28px',
        fontFamily: 'Arial',
        color: '#ffcc44',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(2);

    // Battle log area
    this.logBg = this.add
      .rectangle(cx, cy + 50, 600, 120, 0x000000, 0.6)
      .setDepth(2);
    this.logBorder = this.add
      .rectangle(cx, cy + 50, 600, 120)
      .setStrokeStyle(1, 0x333366)
      .setDepth(2);

    this.logText = this.add
      .text(cx - 290, cy, '', {
        fontSize: '12px',
        fontFamily: 'Arial',
        color: '#cccccc',
        wordWrap: { width: 580 },
        lineSpacing: 3,
      })
      .setDepth(3);

    // Result text (hidden initially)
    this.resultText = this.add
      .text(cx, cy + 150, '', {
        fontSize: '20px',
        fontFamily: 'Arial',
        color: '#ffcc44',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(3)
      .setVisible(false);

    // Store initial HP for animation
    this.playerStartHP = this.playerEntity.hp;
    this.monsterStartHP = this.monsterEntity.hp;
    this.displayPlayerHP = this.playerEntity.hp;
    this.displayMonsterHP = this.monsterEntity.hp;

    // Start auto-battle after a brief pause
    this.addLog(`遭遇 Lv.${this.monsterEntity.level} ${this.monsterEntity.monsterName}！战斗开始！`);

    this.battleTimer = this.time.addEvent({
      delay: 1000,
      callback: this.executeBattleRound,
      callbackScope: this,
      loop: true,
      startAt: 500,
    });
  }

  createPlayerSection(x, y) {
    // Player sprite
    this.add.image(x, y + 30, 'player').setScale(2.5).setDepth(2);

    // Player name
    this.add
      .text(x, y - 20, `${this.playerEntity.playerName} Lv.${this.playerEntity.level}`, {
        fontSize: '14px',
        fontFamily: 'Arial',
        color: '#44ff44',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(2);

    // HP bar background
    this.playerHPBarBg = this.add
      .rectangle(x, y + 70, 160, 16, 0x333333)
      .setDepth(2);

    // HP bar fill
    this.playerHPBar = this.add
      .rectangle(x - 80, y + 70, 160, 16, 0x44cc44)
      .setOrigin(0, 0.5)
      .setDepth(3);

    // HP text
    this.playerHPText = this.add
      .text(x, y + 70, `${this.playerEntity.hp}/${this.playerEntity.max_hp}`, {
        fontSize: '11px',
        fontFamily: 'Arial',
        color: '#ffffff',
      })
      .setOrigin(0.5)
      .setDepth(4);

    // Stats
    this.add
      .text(x, y + 92, `ATK: ${this.playerEntity.attackStat}  DEF: ${this.playerEntity.defenseStat}`, {
        fontSize: '10px',
        fontFamily: 'Arial',
        color: '#aaaaaa',
      })
      .setOrigin(0.5)
      .setDepth(2);

    this.playerBarX = x - 80;
    this.playerBarY = y + 70;
  }

  createMonsterSection(x, y) {
    // Monster sprite
    this.add
      .image(x, y + 30, `monster_${this.monsterEntity.monster_id}`)
      .setScale(2.5)
      .setDepth(2);

    // Monster name
    this.add
      .text(x, y - 20, `${this.monsterEntity.monsterName} Lv.${this.monsterEntity.level}`, {
        fontSize: '14px',
        fontFamily: 'Arial',
        color: '#ff6666',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(2);

    // HP bar background
    this.monsterHPBarBg = this.add
      .rectangle(x, y + 70, 160, 16, 0x333333)
      .setDepth(2);

    // HP bar fill
    this.monsterHPBar = this.add
      .rectangle(x - 80, y + 70, 160, 16, 0xcc4444)
      .setOrigin(0, 0.5)
      .setDepth(3);

    // HP text
    this.monsterHPText = this.add
      .text(
        x,
        y + 70,
        `${this.monsterEntity.hp}/${this.monsterEntity.max_hp}`,
        {
          fontSize: '11px',
          fontFamily: 'Arial',
          color: '#ffffff',
        }
      )
      .setOrigin(0.5)
      .setDepth(4);

    // Stats
    this.add
      .text(x, y + 92, `ATK: ${this.monsterEntity.attackStat}  DEF: ${this.monsterEntity.defenseStat}`, {
        fontSize: '10px',
        fontFamily: 'Arial',
        color: '#aaaaaa',
      })
      .setOrigin(0.5)
      .setDepth(2);

    this.monsterBarX = x - 80;
    this.monsterBarY = y + 70;
  }

  executeBattleRound() {
    if (this.battleOver) return;

    this.roundCount++;

    // Player attacks monster
    const playerDamage = Math.max(
      this.playerEntity.attackStat - this.monsterEntity.defenseStat,
      1
    );
    this.monsterEntity.takeDamage(playerDamage);
    this.addLog(
      `[回合${this.roundCount}] ${this.playerEntity.playerName} 攻击 ${this.monsterEntity.monsterName}，造成 ${playerDamage} 点伤害！`
    );

    // Animate monster HP bar
    this.updateMonsterHP();

    // Check if monster died
    if (this.monsterEntity.hp <= 0) {
      this.endBattle(true);
      return;
    }

    // Monster attacks player (with slight delay for readability)
    this.time.delayedCall(400, () => {
      if (this.battleOver) return;

      const monsterDamage = Math.max(
        this.monsterEntity.attackStat - this.playerEntity.defenseStat,
        1
      );
      this.playerEntity.takeDamage(monsterDamage);
      this.addLog(
        `         ${this.monsterEntity.monsterName} 反击 ${this.playerEntity.playerName}，造成 ${monsterDamage} 点伤害！`
      );

      // Animate player HP bar
      this.updatePlayerHP();

      // Check if player died
      if (this.playerEntity.hp <= 0) {
        this.endBattle(false);
      }
    });
  }

  updatePlayerHP() {
    const ratio = Math.max(0, this.playerEntity.hp / this.playerEntity.max_hp);
    this.tweens.add({
      targets: this.playerHPBar,
      displayWidth: 160 * ratio,
      duration: 300,
      ease: 'Power2',
    });
    this.playerHPText.setText(
      `${Math.max(0, this.playerEntity.hp)}/${this.playerEntity.max_hp}`
    );

    // Change color based on HP percentage
    if (ratio < 0.25) {
      this.playerHPBar.setFillStyle(0xff2222);
    } else if (ratio < 0.5) {
      this.playerHPBar.setFillStyle(0xffaa22);
    }
  }

  updateMonsterHP() {
    const ratio = Math.max(
      0,
      this.monsterEntity.hp / this.monsterEntity.max_hp
    );
    this.tweens.add({
      targets: this.monsterHPBar,
      displayWidth: 160 * ratio,
      duration: 300,
      ease: 'Power2',
    });
    this.monsterHPText.setText(
      `${Math.max(0, this.monsterEntity.hp)}/${this.monsterEntity.max_hp}`
    );

    if (ratio < 0.25) {
      this.monsterHPBar.setFillStyle(0xff2222);
    } else if (ratio < 0.5) {
      this.monsterHPBar.setFillStyle(0xffaa22);
    }
  }

  addLog(text) {
    this.battleLog.push(text);
    // Keep last 6 lines
    if (this.battleLog.length > 6) {
      this.battleLog.shift();
    }
    this.logText.setText(this.battleLog.join('\n'));
  }

  endBattle(victory) {
    this.battleOver = true;
    if (this.battleTimer) {
      this.battleTimer.remove();
    }

    if (victory) {
      this.addLog(
        `\n${this.monsterEntity.monsterName} 被击败了！`
      );
      this.resultText
        .setText(
          `胜利！ 获得 ${this.monsterEntity.exp_reward} EXP, ${this.monsterEntity.gold_reward} 金币`
        )
        .setColor('#44ff44')
        .setVisible(true);
    } else {
      this.addLog(`\n${this.playerEntity.playerName} 被击败了......`);
      this.resultText
        .setText('战斗失败......回到出生点')
        .setColor('#ff4444')
        .setVisible(true);
    }

    // Close battle scene after 2 seconds
    this.time.delayedCall(2000, () => {
      // Emit battle end event to GameScene
      this.gameScene.events.emit('battle-end', {
        victory: victory,
        monster: this.monsterEntity,
        player: this.playerEntity,
      });

      this.scene.stop('BattleScene');
    });
  }
}
