import Phaser from 'phaser';
import DialogueBox from '../ui/DialogueBox.js';
import TaskPanel from '../ui/TaskPanel.js';
import InventoryPanel from '../ui/InventoryPanel.js';

export default class UIScene extends Phaser.Scene {
  constructor() {
    super({ key: 'UIScene' });
  }

  init(data) {
    this.gameScene = data.gameScene;
  }

  create() {
    // ---- Top-left: Player HUD ----
    this.hudBg = this.add
      .rectangle(5, 5, 220, 90, 0x000000, 0.7)
      .setOrigin(0, 0)
      .setDepth(80);

    this.hudBorder = this.add
      .rectangle(5, 5, 220, 90)
      .setStrokeStyle(1, 0x44ff44)
      .setOrigin(0, 0)
      .setDepth(80);

    // Player name and level
    this.nameText = this.add
      .text(15, 10, '勇者 Lv.1', {
        fontSize: '14px',
        fontFamily: 'Arial',
        color: '#44ff44',
        fontStyle: 'bold',
      })
      .setDepth(81);

    // HP label and bar
    this.add
      .text(15, 30, 'HP', {
        fontSize: '11px',
        fontFamily: 'Arial',
        color: '#ff4444',
      })
      .setDepth(81);

    this.hpBarBg = this.add
      .rectangle(40, 33, 150, 12, 0x333333)
      .setOrigin(0, 0)
      .setDepth(81);

    this.hpBar = this.add
      .rectangle(40, 33, 150, 12, 0x44cc44)
      .setOrigin(0, 0)
      .setDepth(82);

    this.hpText = this.add
      .text(115, 33, '100/100', {
        fontSize: '10px',
        fontFamily: 'Arial',
        color: '#ffffff',
      })
      .setOrigin(0.5, 0)
      .setDepth(83);

    // EXP label and bar
    this.add
      .text(15, 50, 'EXP', {
        fontSize: '11px',
        fontFamily: 'Arial',
        color: '#44aaff',
      })
      .setDepth(81);

    this.expBarBg = this.add
      .rectangle(40, 53, 150, 12, 0x333333)
      .setOrigin(0, 0)
      .setDepth(81);

    this.expBar = this.add
      .rectangle(40, 53, 0, 12, 0x4488ff)
      .setOrigin(0, 0)
      .setDepth(82);

    this.expText = this.add
      .text(115, 53, '0/50', {
        fontSize: '10px',
        fontFamily: 'Arial',
        color: '#ffffff',
      })
      .setOrigin(0.5, 0)
      .setDepth(83);

    // ---- Top-right: Gold ----
    this.goldBg = this.add
      .rectangle(675, 5, 120, 28, 0x000000, 0.7)
      .setOrigin(0, 0)
      .setDepth(80);

    this.goldBorder = this.add
      .rectangle(675, 5, 120, 28)
      .setStrokeStyle(1, 0xffcc44)
      .setOrigin(0, 0)
      .setDepth(80);

    this.goldText = this.add
      .text(685, 10, 'Gold: 0', {
        fontSize: '13px',
        fontFamily: 'Arial',
        color: '#ffcc44',
        fontStyle: 'bold',
      })
      .setDepth(81);

    // ---- Controls hint ----
    this.add
      .text(15, 75, 'WASD/方向键移动 | [I]背包 | [T]任务', {
        fontSize: '9px',
        fontFamily: 'Arial',
        color: '#666666',
      })
      .setDepth(81);

    // ---- Notification text (for level ups, drops, etc.) ----
    this.notifyText = this.add
      .text(400, 150, '', {
        fontSize: '18px',
        fontFamily: 'Arial',
        color: '#ffcc44',
        fontStyle: 'bold',
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setDepth(95)
      .setAlpha(0);

    // ---- Task Panel ----
    this.taskPanel = new TaskPanel(this);

    // ---- Inventory Panel ----
    this.inventoryPanel = new InventoryPanel(this);

    // ---- Dialogue Box ----
    this.dialogueBox = new DialogueBox(this);

    // ---- Keyboard shortcuts ----
    this.input.keyboard.on('keydown-I', () => {
      this.inventoryPanel.toggle();
      if (this.inventoryPanel.isVisible) {
        this.updateInventory();
      }
    });

    this.input.keyboard.on('keydown-T', () => {
      this.taskPanel.toggle();
    });

    // ---- Listen for events from GameScene ----
    this.events.on('show-greeting', this.showGreeting, this);
    this.events.on('show-dialogue', this.showDialogue, this);
    this.events.on('task-completed-notify', this.onTaskCompleted, this);
    this.events.on('player-level-up-notify', this.onLevelUp, this);

    // Listen for use-item events from inventory
    this.events.on('use-item', (itemId) => {
      if (this.gameScene.player) {
        const result = this.gameScene.player.useItem(itemId);
        if (result) {
          this.showNotification(result);
          this.updateInventory();
        }
      }
    });
  }

  update() {
    if (!this.gameScene || !this.gameScene.player) return;

    const p = this.gameScene.player;

    // Update HUD
    this.nameText.setText(`${p.playerName} Lv.${p.level}`);

    // HP bar
    const hpRatio = p.hp / p.max_hp;
    this.hpBar.setSize(150 * hpRatio, 12);
    this.hpText.setText(`${p.hp}/${p.max_hp}`);

    if (hpRatio < 0.25) {
      this.hpBar.setFillStyle(0xff2222);
    } else if (hpRatio < 0.5) {
      this.hpBar.setFillStyle(0xffaa22);
    } else {
      this.hpBar.setFillStyle(0x44cc44);
    }

    // EXP bar
    const expRatio = p.exp / p.exp_to_next_level;
    this.expBar.setSize(150 * expRatio, 12);
    this.expText.setText(`${p.exp}/${p.exp_to_next_level}`);

    // Gold
    this.goldText.setText(`Gold: ${p.gold}`);

    // Task panel
    this.taskPanel.update(p.active_tasks, p.completed_tasks);

    // Inventory panel (only if visible)
    if (this.inventoryPanel.isVisible) {
      this.updateInventory();
    }
  }

  updateInventory() {
    if (this.gameScene && this.gameScene.player) {
      this.inventoryPanel.update(this.gameScene.player.inventory);
    }
  }

  showGreeting(data) {
    const { npcName, greeting } = data;
    this.dialogueBox.showGreeting(npcName, greeting);
  }

  showDialogue(data) {
    const { npcName, text, task, waiting } = data;

    this.dialogueBox.show(
      npcName,
      text,
      task,
      // Accept callback
      (acceptedTask) => {
        console.log(`[ACTION] task_accept: task=${acceptedTask.task_id} (${acceptedTask.title})`);
        if (this.gameScene.player) {
          const success = this.gameScene.player.acceptTask(acceptedTask);
          if (success) {
            this.showNotification(`接受任务: ${acceptedTask.title}`);
            // Notify server to update task status in DynamoDB
            if (this.gameScene.wsClient && this.gameScene.wsClient.isConnected()) {
              this.gameScene.wsClient.send('task_accept', {
                player_id: this.gameScene.player.player_id,
                task_id: acceptedTask.task_id,
                npc_id: acceptedTask.npc_id,
              });
            }
          } else {
            this.showNotification('任务已接受或已完成');
          }
        }
        this.gameScene.onDialogueEnd();
      },
      // Close callback
      () => {
        this.gameScene.onDialogueEnd();
      },
      waiting
    );
  }

  onTaskCompleted(task) {
    this.showNotification(`任务完成: ${task.title}！`);
  }

  onLevelUp(player) {
    this.showNotification(`升级！达到 Lv.${player.level}！`);
  }

  showNotification(text) {
    this.notifyText.setText(text).setAlpha(1);
    this.tweens.add({
      targets: this.notifyText,
      alpha: 0,
      y: 120,
      duration: 2500,
      ease: 'Power2',
      onComplete: () => {
        this.notifyText.setY(150);
      },
    });
  }
}
