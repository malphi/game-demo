import { MONSTER_DICT, ITEM_DICT, NPC_DICT } from '../data/GameData.js';

export default class TaskPanel {
  constructor(scene) {
    this.scene = scene;
    this.isVisible = true;
    this.elements = [];

    // Panel background
    this.bg = scene.add
      .rectangle(690, 180, 200, 250, 0x000000, 0.7)
      .setDepth(90)
      .setScrollFactor(0)
      .setOrigin(0, 0);

    this.border = scene.add
      .rectangle(690, 180, 200, 250)
      .setStrokeStyle(1, 0xffcc44)
      .setDepth(90)
      .setScrollFactor(0)
      .setOrigin(0, 0);

    this.titleText = scene.add
      .text(700, 185, '-- 任务 --', {
        fontSize: '13px',
        fontFamily: 'Arial',
        color: '#ffcc44',
        fontStyle: 'bold',
      })
      .setDepth(91)
      .setScrollFactor(0);

    this.taskTexts = [];
  }

  update(activeTasks, completedTasks) {
    // Clear old task texts
    for (const t of this.taskTexts) {
      t.destroy();
    }
    this.taskTexts = [];

    let yOffset = 205;

    if (activeTasks.length === 0) {
      const noTask = this.scene.add
        .text(700, yOffset, '暂无任务', {
          fontSize: '11px',
          fontFamily: 'Arial',
          color: '#888888',
        })
        .setDepth(91)
        .setScrollFactor(0);
      this.taskTexts.push(noTask);
      return;
    }

    for (const task of activeTasks) {
      // Task title
      const isComplete = task.status === 'completed';
      const titleColor = isComplete ? '#44ff44' : '#ffffff';
      const prefix = isComplete ? '[done] ' : '';

      const title = this.scene.add
        .text(700, yOffset, `${prefix}${task.title}`, {
          fontSize: '11px',
          fontFamily: 'Arial',
          color: titleColor,
          fontStyle: 'bold',
          wordWrap: { width: 180 },
        })
        .setDepth(91)
        .setScrollFactor(0);
      this.taskTexts.push(title);
      yOffset += 18;

      // Conditions
      for (const cond of task.conditions) {
        const targetName = this.getTargetName(cond.type, cond.target_id);
        const condColor =
          cond.current_count >= cond.required_count ? '#44ff44' : '#cccccc';
        const condText = this.scene.add
          .text(
            710,
            yOffset,
            `${targetName}: ${cond.current_count}/${cond.required_count}`,
            {
              fontSize: '10px',
              fontFamily: 'Arial',
              color: condColor,
            }
          )
          .setDepth(91)
          .setScrollFactor(0);
        this.taskTexts.push(condText);
        yOffset += 14;
      }

      yOffset += 6;
    }

    // Resize panel to fit content
    const panelHeight = Math.max(250, yOffset - 180 + 15);
    this.bg.setSize(200, panelHeight);
    this.border.setSize(200, panelHeight);
  }

  getTargetName(condType, targetId) {
    if (condType === 'kill_monster') {
      return MONSTER_DICT[targetId]?.name || targetId;
    }
    if (condType === 'collect_item' || condType === 'use_item') {
      return ITEM_DICT[targetId]?.name || targetId;
    }
    if (condType === 'talk_to_npc') {
      return NPC_DICT[targetId]?.name || targetId;
    }
    return targetId;
  }

  show() {
    this.isVisible = true;
    this.bg.setVisible(true);
    this.border.setVisible(true);
    this.titleText.setVisible(true);
    for (const t of this.taskTexts) t.setVisible(true);
  }

  hide() {
    this.isVisible = false;
    this.bg.setVisible(false);
    this.border.setVisible(false);
    this.titleText.setVisible(false);
    for (const t of this.taskTexts) t.setVisible(false);
  }

  toggle() {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }

  destroy() {
    this.bg.destroy();
    this.border.destroy();
    this.titleText.destroy();
    for (const t of this.taskTexts) t.destroy();
  }
}
