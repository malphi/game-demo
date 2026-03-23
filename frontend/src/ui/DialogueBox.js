import Phaser from 'phaser';
import { MONSTER_DICT, ITEM_DICT, NPC_DICT } from '../data/GameData.js';

export default class DialogueBox {
  constructor(scene) {
    this.scene = scene;
    this.isVisible = false;
    this.typewriterTimer = null;
    this.fullText = '';
    this.currentCharIndex = 0;
    this.currentTask = null;
    this.onAcceptCallback = null;
    this.onCloseCallback = null;
    this.isShowingGreeting = false;
    this.isWaitingAfterGreeting = false;
    this.pendingDialogue = null;

    this.createElements();
    this.setupKeyboard();
    this.hide();
  }

  setupKeyboard() {
    // Pressing any arrow key or Escape or Enter closes dialogue (when no task) or accepts task
    this.keyHandler = (event) => {
      if (!this.isVisible || this.isWaiting) return;
      const key = event.key;
      if (key === 'Escape' || key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight') {
        this.onClose();
      } else if (key === 'Enter') {
        // Enter accepts task if available, otherwise closes
        if (this.currentTask) {
          this.onAccept();
        } else {
          this.onClose();
        }
      }
    };
    this.scene.input.keyboard.on('keydown', this.keyHandler);
  }

  createElements() {
    const width = 780;
    const height = 180;
    const x = 400;
    const y = 520;

    // Background
    this.bg = this.scene.add
      .rectangle(x, y, width, height, 0x000000, 0.85)
      .setDepth(100)
      .setScrollFactor(0);

    // Border
    this.border = this.scene.add
      .rectangle(x, y, width, height)
      .setStrokeStyle(2, 0x4488ff)
      .setDepth(100)
      .setScrollFactor(0);

    // NPC Name
    this.nameText = this.scene.add
      .text(x - width / 2 + 15, y - height / 2 + 10, '', {
        fontSize: '16px',
        fontFamily: 'Arial',
        color: '#88ccff',
        fontStyle: 'bold',
      })
      .setDepth(101)
      .setScrollFactor(0);

    // Dialogue text
    this.dialogueText = this.scene.add
      .text(x - width / 2 + 15, y - height / 2 + 35, '', {
        fontSize: '13px',
        fontFamily: 'Arial',
        color: '#ffffff',
        wordWrap: { width: width - 30 },
        lineSpacing: 4,
      })
      .setDepth(101)
      .setScrollFactor(0);

    // Task info text
    this.taskText = this.scene.add
      .text(x - width / 2 + 15, y - height / 2 + 100, '', {
        fontSize: '11px',
        fontFamily: 'Arial',
        color: '#ffcc44',
        wordWrap: { width: width - 200 },
        lineSpacing: 2,
      })
      .setDepth(101)
      .setScrollFactor(0);

    // Accept Task button
    this.acceptBtn = this.scene.add
      .text(x + width / 2 - 140, y + height / 2 - 35, '[ 接受任务 ]', {
        fontSize: '14px',
        fontFamily: 'Arial',
        color: '#44ff44',
        fontStyle: 'bold',
      })
      .setDepth(101)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true })
      .on('pointerover', () => this.acceptBtn.setColor('#88ff88'))
      .on('pointerout', () => this.acceptBtn.setColor('#44ff44'))
      .on('pointerdown', () => this.onAccept());

    // Close button
    this.closeBtn = this.scene.add
      .text(x + width / 2 - 60, y + height / 2 - 35, '[ 关闭 ]', {
        fontSize: '14px',
        fontFamily: 'Arial',
        color: '#aaaaaa',
      })
      .setDepth(101)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true })
      .on('pointerover', () => this.closeBtn.setColor('#ffffff'))
      .on('pointerout', () => this.closeBtn.setColor('#aaaaaa'))
      .on('pointerdown', () => this.onClose());
  }

  showGreeting(npcName, greetingText) {
    // If we already have the full dialogue, skip greeting
    if (!this.isWaiting && this.isVisible && !this.isShowingGreeting) return;

    this.isShowingGreeting = true;
    this.pendingDialogue = null;

    // Replace waiting dots with greeting typewriter
    this.isWaiting = false;
    this.nameText.setText(npcName);
    this.fullText = greetingText;
    this.currentCharIndex = 0;
    this.dialogueText.setText('');

    if (this.typewriterTimer) {
      this.typewriterTimer.remove();
    }

    this.typewriterTimer = this.scene.time.addEvent({
      delay: 100,
      callback: () => {
        if (this.currentCharIndex < this.fullText.length) {
          this.currentCharIndex++;
          this.dialogueText.setText(this.fullText.substring(0, this.currentCharIndex));
        } else {
          this.typewriterTimer.remove();
          this.isShowingGreeting = false;
          // If LLM response arrived while greeting was playing, transition now
          if (this.pendingDialogue) {
            const pd = this.pendingDialogue;
            this.pendingDialogue = null;
            this.transitionToDialogue(pd.text, pd.task, pd.onAccept, pd.onClose);
          } else {
            // Greeting done but dialogue response hasn't arrived yet — show waiting + close button
            this.isWaitingAfterGreeting = true;
            this.closeBtn.setVisible(true);
            // Append animated waiting dots after greeting text
            const greetingText = this.fullText;
            let dots = 0;
            this.typewriterTimer = this.scene.time.addEvent({
              delay: 400,
              callback: () => {
                dots = (dots % 3) + 1;
                this.dialogueText.setText(greetingText + '\n' + '.'.repeat(dots));
              },
              loop: true,
            });
          }
        }
      },
      loop: true,
    });

    // Show box elements (no buttons during greeting)
    this.setAllVisible(true);
    this.acceptBtn.setVisible(false);
    this.closeBtn.setVisible(false);
  }

  transitionToDialogue(text, task, onAccept, onClose) {
    this.currentTask = task;
    this.onAcceptCallback = onAccept;
    this.onCloseCallback = onClose;

    // Brief pause, then show full dialogue with typewriter
    this.scene.time.delayedCall(300, () => {
      this.fullText = text;
      this.currentCharIndex = 0;
      this.dialogueText.setText('');

      if (this.typewriterTimer) {
        this.typewriterTimer.remove();
      }

      this.typewriterTimer = this.scene.time.addEvent({
        delay: 100,
        callback: () => {
          if (this.currentCharIndex < this.fullText.length) {
            this.currentCharIndex++;
            this.dialogueText.setText(this.fullText.substring(0, this.currentCharIndex));
          } else {
            this.typewriterTimer.remove();
          }
        },
        loop: true,
      });

      // Show task info and buttons
      this.showTaskInfo(task);
      this.closeBtn.setVisible(true);
    });
  }

  show(npcName, text, task = null, onAccept = null, onClose = null, waiting = false) {
    // If greeting is still playing, buffer this dialogue for later
    if (this.isShowingGreeting && !waiting) {
      this.pendingDialogue = { text, task, onAccept, onClose };
      return;
    }

    // If we were waiting after greeting ended, transition smoothly to dialogue
    if (this.isWaitingAfterGreeting && !waiting) {
      this.isWaitingAfterGreeting = false;
      this.transitionToDialogue(text, task, onAccept, onClose);
      return;
    }

    this.isVisible = true;
    this.isWaiting = waiting;
    this.isShowingGreeting = false;
    this.isWaitingAfterGreeting = false;
    this.pendingDialogue = null;
    this.currentTask = task;
    this.onAcceptCallback = onAccept;
    this.onCloseCallback = onClose;

    this.nameText.setText(npcName);

    // Typewriter effect
    this.fullText = text;
    this.currentCharIndex = 0;
    this.dialogueText.setText('');

    if (this.typewriterTimer) {
      this.typewriterTimer.remove();
    }

    if (waiting) {
      // Show animated dots for waiting state
      let dots = 0;
      this.typewriterTimer = this.scene.time.addEvent({
        delay: 400,
        callback: () => {
          dots = (dots % 6) + 1;
          this.dialogueText.setText('.'.repeat(dots));
        },
        loop: true,
      });
    } else {
      this.typewriterTimer = this.scene.time.addEvent({
        delay: 100,
        callback: () => {
          if (this.currentCharIndex < this.fullText.length) {
            this.currentCharIndex++;
            this.dialogueText.setText(
              this.fullText.substring(0, this.currentCharIndex)
            );
          } else {
            this.typewriterTimer.remove();
          }
        },
        loop: true,
      });
    }

    // Show task info
    this.showTaskInfo(task);

    // In waiting mode, hide buttons
    if (waiting) {
      this.acceptBtn.setVisible(false);
      this.closeBtn.setVisible(false);
    }

    // Show all elements
    this.setAllVisible(true);
  }

  _resolveTargetName(type, targetId) {
    if (type === 'kill_monster') return MONSTER_DICT[targetId]?.name || targetId;
    if (type === 'collect_item' || type === 'use_item') return ITEM_DICT[targetId]?.name || targetId;
    if (type === 'talk_to_npc') return NPC_DICT[targetId]?.name || targetId;
    return targetId;
  }

  showTaskInfo(task) {
    if (task) {
      let taskInfo = `[任务] ${task.title}\n`;
      for (const cond of task.conditions) {
        const typeNames = {
          kill_monster: '击杀',
          collect_item: '收集',
          talk_to_npc: '对话',
          use_item: '使用',
        };
        const targetName = this._resolveTargetName(cond.type, cond.target_id);
        taskInfo += `  ${typeNames[cond.type] || cond.type}: ${targetName} x${cond.required_count}\n`;
      }
      taskInfo += `奖励: `;
      const awardTexts = task.awards.map((a) => {
        if (a.type === 'gold') return `${a.value}金币`;
        if (a.type === 'exp') return `${a.value}经验`;
        if (a.type === 'item') {
          const itemName = ITEM_DICT[a.item_id]?.name || a.item_id;
          return `${itemName} x${a.quantity}`;
        }
        return '';
      });
      taskInfo += awardTexts.join(', ');
      this.taskText.setText(taskInfo);
      this.acceptBtn.setVisible(true);
    } else {
      this.taskText.setText('');
      this.acceptBtn.setVisible(false);
    }
  }

  hide() {
    this.isVisible = false;
    if (this.typewriterTimer) {
      this.typewriterTimer.remove();
      this.typewriterTimer = null;
    }
    this.setAllVisible(false);
  }

  setAllVisible(visible) {
    this.bg.setVisible(visible);
    this.border.setVisible(visible);
    this.nameText.setVisible(visible);
    this.dialogueText.setVisible(visible);
    this.taskText.setVisible(visible);
    this.acceptBtn.setVisible(visible && this.currentTask !== null && !this.isWaiting);
    this.closeBtn.setVisible(visible && !this.isWaiting);
  }

  onAccept() {
    if (this.onAcceptCallback && this.currentTask) {
      this.onAcceptCallback(this.currentTask);
    }
    this.hide();
  }

  onClose() {
    if (this.onCloseCallback) {
      this.onCloseCallback();
    }
    this.hide();
  }

  destroy() {
    if (this.typewriterTimer) {
      this.typewriterTimer.remove();
    }
    if (this.keyHandler) {
      this.scene.input.keyboard.off('keydown', this.keyHandler);
    }
    this.bg.destroy();
    this.border.destroy();
    this.nameText.destroy();
    this.dialogueText.destroy();
    this.taskText.destroy();
    this.acceptBtn.destroy();
    this.closeBtn.destroy();
  }
}
