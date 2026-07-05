import Phaser from 'phaser';
import Player from '../entities/Player.js';
import Monster from '../entities/Monster.js';
import NPC from '../entities/NPC.js';
import {
  MONSTER_DICT,
  NPC_DICT,
  MONSTER_SPAWNS,
  ITEM_DICT,
} from '../data/GameData.js';
import WebSocketClient from '../network/WebSocketClient.js';
import RemotePlayer from '../entities/RemotePlayer.js';

export default class GameScene extends Phaser.Scene {
  constructor() {
    super({ key: 'GameScene' });
    this.monsters = [];
    this.npcs = [];
    this.wsClient = null;
    this.battleCooldown = false;
    this.dialogueCooldown = false;
    this.lastDialogueNpcId = null; // Track NPC to prevent re-trigger while still overlapping
    this.remotePlayers = new Map(); // player_id -> RemotePlayer
    this.lastPositionSendTime = 0;
  }

  create() {
    const worldWidth = 1600;
    const worldHeight = 1200;

    // Set world bounds
    this.physics.world.setBounds(0, 0, worldWidth, worldHeight);

    // Add ground
    this.add.image(worldWidth / 2, worldHeight / 2, 'ground').setDepth(0);

    // Add area labels
    this.add
      .text(175, 80, '[ 史莱姆草地 ]', {
        fontSize: '12px',
        color: '#ff8888',
        stroke: '#000',
        strokeThickness: 2,
      })
      .setOrigin(0.5)
      .setDepth(1);

    this.add
      .text(950, 250, '[ 哥布林森林 ]', {
        fontSize: '12px',
        color: '#ff8888',
        stroke: '#000',
        strokeThickness: 2,
      })
      .setOrigin(0.5)
      .setDepth(1);

    this.add
      .text(1150, 650, '[ 灰狼山地 ]', {
        fontSize: '12px',
        color: '#ff8888',
        stroke: '#000',
        strokeThickness: 2,
      })
      .setOrigin(0.5)
      .setDepth(1);

    this.add
      .text(1350, 870, '[ 兽人营地 ]', {
        fontSize: '12px',
        color: '#ff8888',
        stroke: '#000',
        strokeThickness: 2,
      })
      .setOrigin(0.5)
      .setDepth(1);

    this.add
      .text(1400, 1020, '[ 幼龙巢穴 ]', {
        fontSize: '12px',
        color: '#ff4444',
        stroke: '#000',
        strokeThickness: 2,
      })
      .setOrigin(0.5)
      .setDepth(1);

    this.add
      .text(500, 180, '[ 村庄 ]', {
        fontSize: '14px',
        color: '#88ccff',
        stroke: '#000',
        strokeThickness: 2,
      })
      .setOrigin(0.5)
      .setDepth(1);

    // Create player
    this.player = new Player(this, 400, 300);

    // Setup input
    this.cursors = {
      up: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.UP),
      down: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN),
      left: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT),
      right: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT),
      keyW: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      keyA: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      keyS: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      keyD: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };

    // Spawn monsters
    this.monsterGroup = this.physics.add.group();
    for (const spawn of MONSTER_SPAWNS) {
      const monster = new Monster(this, spawn.x, spawn.y, spawn.monster_id);
      this.monsters.push(monster);
      this.monsterGroup.add(monster);
    }

    // Spawn NPCs
    this.npcGroup = this.physics.add.group();
    for (const [id, data] of Object.entries(NPC_DICT)) {
      const npc = new NPC(this, data);
      this.npcs.push(npc);
      this.npcGroup.add(npc);
    }

    // Setup camera
    this.cameras.main.setBounds(0, 0, worldWidth, worldHeight);
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);

    // Overlap detection: Player <-> Monsters
    this.physics.add.overlap(
      this.player,
      this.monsterGroup,
      this.onPlayerMonsterOverlap,
      null,
      this
    );

    // Overlap detection: Player <-> NPCs
    this.physics.add.overlap(
      this.player,
      this.npcGroup,
      this.onPlayerNPCOverlap,
      null,
      this
    );

    // Launch UI Scene (overlay)
    this.scene.launch('UIScene', { gameScene: this });

    // WebSocket connection
    this.wsClient = new WebSocketClient();
    this.wsClient.connect().then(async (connected) => {
      if (connected) {
        console.log('Connected to server');
        this.setupWSHandlers();
        // Register player with the server so NPC dialogue can find the player
        try {
          const reqBody = {
            player_id: this.player.player_id,
            name: this.player.playerName,
          };
          console.log('[API:REQ] POST /api/game/start', reqBody);
          const resp = await fetch(`${window.location.origin}/api/game/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(reqBody),
          });
          const respData = await resp.json();
          console.log('[API:RESP] POST /api/game/start', resp.status, respData);
        } catch (err) {
          console.warn('[API:ERR] POST /api/game/start', err.message);
        }
        // Register for multiplayer visibility
        this.wsClient.send('player_register', {
          player_id: this.player.player_id,
          x: this.player.x,
          y: this.player.y,
          character: this.player.player_id === '2' ? 'player_2' : 'player',
          name: this.player.playerName,
        });
      } else {
        console.error('Failed to connect to server');
      }
    });

    // Listen for battle end events from BattleScene
    this.events.on('battle-end', this.onBattleEnd, this);

    // Listen for task-completed event
    this.events.on('task-completed', (task) => {
      // Notify UI scene
      const uiScene = this.scene.get('UIScene');
      if (uiScene) {
        uiScene.events.emit('task-completed-notify', task);
      }
      // Notify server to update task status in DynamoDB
      if (this.wsClient && this.wsClient.isConnected()) {
        this.wsClient.send('task_complete', {
          player_id: this.player.player_id,
          task_id: task.task_id,
        });
      }
    });

    // Listen for player-level-up event
    this.events.on('player-level-up', (player) => {
      const uiScene = this.scene.get('UIScene');
      if (uiScene) {
        uiScene.events.emit('player-level-up-notify', player);
      }
    });

    // Controls hint
    this.add
      .text(worldWidth / 2, worldHeight - 20, 'WASD/Arrow Keys: Move | Walk into monsters to battle | Walk near NPCs to talk', {
        fontSize: '11px',
        color: '#555555',
        stroke: '#000',
        strokeThickness: 1,
      })
      .setOrigin(0.5)
      .setDepth(1);
  }

  update() {
    // Stop player movement when inventory panel is open (arrow keys navigate items)
    const uiScene = this.scene.get('UIScene');
    if (uiScene?.inventoryPanel?.isVisible) {
      this.player.body.setVelocity(0, 0);
    } else {
      this.player.move(this.cursors);
    }

    // Send local player position to server (throttled to every 100ms)
    const now = Date.now();
    if (now - this.lastPositionSendTime > 100 && this.wsClient?.isConnected()) {
      this.lastPositionSendTime = now;
      this.wsClient.send('player_move', {
        player_id: this.player.player_id,
        x: Math.round(this.player.x),
        y: Math.round(this.player.y),
      });
    }

    // Update monster name positions
    for (const monster of this.monsters) {
      if (!monster.isDead) {
        monster.update();
      }
    }

    // Update NPC positions
    for (const npc of this.npcs) {
      npc.update();
    }

    // Clear lastDialogueNpcId when player has moved away from that NPC
    if (this.lastDialogueNpcId && !this.player.isInDialogue) {
      const lastNpc = this.npcs.find((n) => n.npc_id === this.lastDialogueNpcId);
      if (lastNpc) {
        const dx = this.player.x - lastNpc.x;
        const dy = this.player.y - lastNpc.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        // Clear once player is far enough from the NPC (well outside overlap range)
        if (dist > 60) {
          this.lastDialogueNpcId = null;
        }
      } else {
        this.lastDialogueNpcId = null;
      }
    }
  }

  onPlayerMonsterOverlap(player, monsterSprite) {
    if (this.battleCooldown || player.isInBattle || player.isInDialogue) return;

    // Find our Monster instance
    const monster = this.monsters.find((m) => m === monsterSprite);
    if (!monster || monster.isDead) return;

    this.battleCooldown = true;
    player.isInBattle = true;
    player.body.setVelocity(0, 0);
    console.log(`[ACTION] battle_start: monster=${monster.monster_id} (Lv.${monster.level} ${monster.monsterName}), player ATK=${player.attackStat} DEF=${player.defenseStat} HP=${player.hp}`);

    // Start battle
    if (this.wsClient && this.wsClient.isConnected()) {
      this.wsClient.send('battle_start', {
        player_id: player.player_id,
        monster_id: monster.monster_id,
      });
    }

    // Launch BattleScene as overlay
    this.scene.launch('BattleScene', {
      player: player,
      monster: monster,
      gameScene: this,
    });

    // Pause this scene's physics but keep rendering
    this.physics.pause();
  }

  onPlayerNPCOverlap(player, npcSprite) {
    if (this.dialogueCooldown || player.isInBattle || player.isInDialogue)
      return;

    const npc = this.npcs.find((n) => n === npcSprite);
    if (!npc) return;

    // Don't re-trigger dialogue for the same NPC until player has walked away
    if (this.lastDialogueNpcId === npc.npc_id) return;

    // Only trigger at close range (within 30px center-to-center)
    const dx = player.x - npc.x;
    const dy = player.y - npc.y;
    if (Math.sqrt(dx * dx + dy * dy) > 30) return;

    this.dialogueCooldown = true;
    player.isInDialogue = true;
    this.lastDialogueNpcId = npc.npc_id;
    player.body.setVelocity(0, 0);
    console.log(`[ACTION] npc_dialogue_start: npc=${npc.npc_id} (${npc.npcName})`);

    this.wsClient.send('npc_dialogue_start', {
      player_id: player.player_id,
      npc_id: npc.npc_id,
    });
    // Show waiting indicator while LLM processes
    const uiScene = this.scene.get('UIScene');
    if (uiScene) {
      uiScene.events.emit('show-dialogue', {
        npcName: npc.npcName,
        text: '......',
        task: null,
        waiting: true,
      });
    }
  }

  onBattleEnd(result) {
    this.physics.resume();
    const monster = result.monster;
    console.log(`[ACTION] battle_end: ${result.victory ? 'VICTORY' : 'DEFEAT'}, monster=${monster.monster_id}, player HP=${this.player.hp}`);

    if (result.victory) {
      // Grant rewards
      this.player.addExp(monster.exp_reward);
      this.player.addGold(monster.gold_reward);

      // Drop items
      for (const drop of monster.drop_items) {
        if (Math.random() < drop.probability) {
          this.player.addItem(drop.item_id, 1);
          // Show drop notification
          const itemName = ITEM_DICT[drop.item_id]?.name || drop.item_id;
          this.showFloatingText(
            this.player.x,
            this.player.y - 30,
            `+${itemName}`,
            '#ffcc44'
          );
        }
      }

      // Update kill_monster tasks
      this.player.updateTaskProgress('kill_monster', monster.monster_id);

      // Kill monster and schedule respawn
      monster.kill();
      this.time.delayedCall(5000, () => {
        monster.respawn();
      });
    } else {
      // Player defeated - respawn at starting position
      this.player.respawn();
    }

    // Reset battle state after short delay
    this.time.delayedCall(500, () => {
      this.player.isInBattle = false;
      this.battleCooldown = false;
    });
  }

  onDialogueEnd() {
    console.log('[ACTION] dialogue_end');
    this.player.isInDialogue = false;
    this.time.delayedCall(2000, () => {
      this.dialogueCooldown = false;
    });
  }

  setupWSHandlers() {
    // Greeting arrives fast (~100ms), displayed with typewriter while LLM processes
    this.wsClient.on('npc_dialogue_greeting', (data) => {
      const uiScene = this.scene.get('UIScene');
      if (uiScene) {
        uiScene.events.emit('show-greeting', {
          npcName: data.npc_name,
          greeting: data.greeting,
        });
      }
    });

    this.wsClient.on('npc_dialogue_response', (data) => {
      // Write debug log to Agent Console panel
      if (data.debug_log && data.debug_log.length > 0) {
        this.writeAgentConsole(data.npc_name, data.debug_log);
      }

      // Transition from greeting to full dialogue response
      const uiScene = this.scene.get('UIScene');
      if (uiScene) {
        uiScene.events.emit('show-dialogue', {
          npcName: data.npc_name,
          text: data.dialogue,
          task: data.task || null,
        });
      }
    });

    this.wsClient.on('error', (data) => {
      console.error('Server error:', data.message);
      // Reset dialogue state if we're stuck in dialogue
      if (this.player.isInDialogue) {
        this.onDialogueEnd();
      }
    });

    this.wsClient.on('battle_end', (data) => {
      // Server-driven battle end (if needed)
    });

    this.wsClient.on('task_update', (data) => {
      // Server-driven task update
    });

    // --- Pre-generation event handlers ---
    this.wsClient.on('pre_generation_started', (data) => {
      console.log(`[PreGen] Started: event=${data.event_type}`);
      this.writePreGenConsole('started', data.event_type, data);
    });

    this.wsClient.on('pre_generation_complete', (data) => {
      console.log(`[PreGen] Complete: event=${data.event_type}, npc=${data.npc_name}, hasTask=${data.has_task}`);
      this.writePreGenConsole('complete', data.event_type, data);
    });

    this.wsClient.on('pre_generation_skipped', (data) => {
      console.log(`[PreGen] Skipped: event=${data.event_type}, reason=${data.reason}`);
    });

    // --- Multiplayer handlers ---
    this.wsClient.on('players_list', (data) => {
      for (const p of data.players || []) {
        if (p.player_id !== this.player.player_id && !this.remotePlayers.has(p.player_id)) {
          const remote = new RemotePlayer(this, p);
          this.remotePlayers.set(p.player_id, remote);
          console.log(`[MP] Existing player: ${p.player_id} (${p.name})`);
        }
      }
    });

    this.wsClient.on('player_join', (data) => {
      if (data.player_id === this.player.player_id) return;
      if (this.remotePlayers.has(data.player_id)) return;
      const remote = new RemotePlayer(this, data);
      this.remotePlayers.set(data.player_id, remote);
      console.log(`[MP] Player joined: ${data.player_id} (${data.name})`);
    });

    this.wsClient.on('player_leave', (data) => {
      const remote = this.remotePlayers.get(data.player_id);
      if (remote) {
        remote.destroy();
        this.remotePlayers.delete(data.player_id);
        console.log(`[MP] Player left: ${data.player_id}`);
      }
    });

    this.wsClient.on('player_moved', (data) => {
      const remote = this.remotePlayers.get(data.player_id);
      if (remote) {
        remote.updatePosition(data.x, data.y);
      }
    });
  }

  writeAgentConsole(npcName, debugLog) {
    const consoleBody = document.getElementById('agent-console-body');
    if (!consoleBody) return;

    const now = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    let html = `<div class="log-session">`;
    html += `<div class="log-header">[${now}] NPC: ${npcName}</div>`;

    let lastToolName = '';
    for (const entry of debugLog) {
      if (entry.type === 'memory' && entry.action === 'save_event') {
        html += `<div class="log-entry log-memory">[Memory] 写入事件: ${this.escapeHtml(entry.description || entry.event_type)}</div>`;
      } else if (entry.type === 'memory') {
        const status = entry.enabled ? 'ON' : 'OFF';
        const detail = entry.enabled
          ? `actor=${this.escapeHtml(entry.actor_id)}, session=${this.escapeHtml(entry.session_id)}`
          : 'AGENTCORE_MEMORY_ID not set';
        html += `<div class="log-entry log-memory">[Memory] ${status} — ${detail}</div>`;
      } else if (entry.type === 'llm') {
        html += `<div class="log-entry log-llm">[LLM] ${this.escapeHtml(entry.model_id)}`;
        html += ` | region=${this.escapeHtml(entry.region)}`;
        html += ` | cache=${entry.prompt_caching ? 'ON' : 'OFF'}`;
        html += ` | npc=${this.escapeHtml(entry.npc)}</div>`;
      } else if (entry.type === 'kb_query') {
        const statusIcon = entry.status === 'ok' ? '✓' : entry.status === 'skipped' ? '⊘' : '✗';
        html += `<div class="log-entry log-kb">[KB] ${statusIcon} "${this.escapeHtml(entry.query)}"`;
        if (entry.status === 'ok') {
          html += ` → ${entry.results} results (${entry.ms}ms)`;
        } else {
          html += ` → ${this.escapeHtml(entry.reason || entry.status)}`;
        }
        html += `</div>`;
      } else if (entry.type === 'tool_call') {
        lastToolName = entry.name;
        const isGetter = entry.name.startsWith('get_');
        html += `<div class="log-entry log-tool-call">`;
        html += `<span class="log-tool-name">[MCP Tool] ${entry.name}</span>`;
        if (entry.input && Object.keys(entry.input).length > 0) {
          if (isGetter) {
            html += `(${this.escapeHtml(JSON.stringify(entry.input))})`;
          } else {
            html += `<div class="log-tool-result">${this.escapeHtml(JSON.stringify(entry.input, null, 2))}</div>`;
          }
        }
        html += `</div>`;
      } else if (entry.type === 'tool_result') {
        // Skip results for get_* methods, only show for create_task etc.
        if (!lastToolName.startsWith('get_')) {
          html += `<div class="log-entry"><div class="log-tool-result">${this.escapeHtml(entry.result)}</div></div>`;
        }
      } else if (entry.type === 'reasoning') {
        html += `<div class="log-entry log-reasoning">${this.escapeHtml(entry.text)}</div>`;
      } else if (entry.type === 'data_prefetch') {
        const icon = entry.source === 'KB' ? '📚' : entry.source === 'Memory' ? '🧠' : '🗄️';
        const label = entry.label || (entry.queries ? entry.queries.join(', ') : entry.kb_id ? `monsters=${entry.monsters_from_kb}, items=${entry.items_from_kb}` : entry.source);
        html += `<div class="log-entry log-prefetch">${icon} [${this.escapeHtml(entry.source)}] ${this.escapeHtml(label)} (${entry.ms}ms)</div>`;
      } else if (entry.type === 'pre_generated') {
        html += `<div class="log-entry log-prefetch">⚡ [Pre-Generated] event=${this.escapeHtml(entry.event_type)} (${entry.ms}ms — instant delivery)</div>`;
      } else if (entry.type === 'error') {
        html += `<div class="log-entry" style="color:#ff4444;">[Error] ${this.escapeHtml(entry.message)} (${entry.ms || 0}ms)</div>`;
      } else if (entry.type === 'timing') {
        const details = Object.entries(entry.details || {})
          .map(([k, v]) => `${k}: ${v}${typeof v === 'number' ? 'ms' : ''}`)
          .join(', ');
        html += `<div class="log-entry log-timing">⏱ ${this.escapeHtml(entry.label)}: ${entry.total_ms}ms (${this.escapeHtml(details)})</div>`;
      }
    }

    html += `</div>`;
    consoleBody.innerHTML += html;
    consoleBody.scrollTop = consoleBody.scrollHeight;
  }

  writePreGenConsole(status, eventType, data) {
    const consoleBody = document.getElementById('agent-console-body');
    if (!consoleBody) return;

    const now = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    let html = `<div class="log-session">`;

    if (status === 'started') {
      html += `<div class="log-header">[${now}] 事件驱动预生成</div>`;
      html += `<div class="log-entry log-prefetch">⚡ [PreGen] 事件 "${this.escapeHtml(eventType)}" 触发，正在后台调用 LLM 预生成任务...</div>`;
    } else if (status === 'complete') {
      html += `<div class="log-header">[${now}] 预生成完成</div>`;
      html += `<div class="log-entry log-prefetch">⚡ [PreGen] NPC "${this.escapeHtml(data.npc_name || '')}" 的对话和任务已缓存，等待玩家对话时即时下发</div>`;
    } else if (status === 'skipped') {
      html += `<div class="log-header">[${now}] 预生成跳过</div>`;
      html += `<div class="log-entry" style="color:#999;">⊘ [PreGen] ${this.escapeHtml(data.reason || '该NPC已有活跃任务')}</div>`;
    }

    html += `</div>`;
    consoleBody.innerHTML += html;
    consoleBody.scrollTop = consoleBody.scrollHeight;
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  showFloatingText(x, y, text, color = '#ffffff') {
    const floatText = this.add
      .text(x, y, text, {
        fontSize: '12px',
        fontFamily: 'Arial',
        color: color,
        stroke: '#000000',
        strokeThickness: 2,
      })
      .setOrigin(0.5)
      .setDepth(50);

    this.tweens.add({
      targets: floatText,
      y: y - 40,
      alpha: 0,
      duration: 1500,
      onComplete: () => floatText.destroy(),
    });
  }
}
