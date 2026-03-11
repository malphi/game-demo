import Phaser from 'phaser';
import { MONSTER_DICT, NPC_DICT } from '../data/GameData.js';

export default class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  preload() {
    // All sprites are procedurally generated, no external images needed
  }

  create() {
    const loadText = this.add
      .text(400, 300, '生成游戏资源中...', {
        fontSize: '20px',
        fontFamily: 'Arial',
        color: '#ffffff',
      })
      .setOrigin(0.5);

    // Generate player texture
    this.generatePlayerTexture();

    // Generate monster textures
    for (const [id, data] of Object.entries(MONSTER_DICT)) {
      this.generateMonsterTexture(id, data);
    }

    // Generate NPC textures
    for (const [id, data] of Object.entries(NPC_DICT)) {
      this.generateNPCTexture(id, data);
    }

    // Generate ground tilemap texture
    this.generateGroundTexture();

    // Transition to GameScene after a short delay
    this.time.delayedCall(500, () => {
      loadText.destroy();
      this.scene.start('GameScene');
    });
  }

  /**
   * Draw pixel art from a 2D character grid mapped to a color palette.
   * @param {Phaser.GameObjects.Graphics} gfx
   * @param {string[]} pixelMap - Array of strings; each char is a palette key, '.' = skip
   * @param {Object} palette - Maps single chars to 0xRRGGBB hex colors
   * @param {number} scale - Pixel size (1 = 1px per cell)
   * @param {number} offsetX
   * @param {number} offsetY
   */
  drawPixelArt(gfx, pixelMap, palette, scale = 1, offsetX = 0, offsetY = 0) {
    for (let y = 0; y < pixelMap.length; y++) {
      const row = pixelMap[y];
      for (let x = 0; x < row.length; x++) {
        const ch = row[x];
        if (ch === '.' || palette[ch] === undefined) continue;
        gfx.fillStyle(palette[ch], 1);
        gfx.fillRect(
          offsetX + x * scale,
          offsetY + y * scale,
          scale,
          scale
        );
      }
    }
  }

  // ─── PLAYER (24×24) ─── Adventurer with brown hair, blue tunic, sword ───

  generatePlayerTexture() {
    const gfx = this.add.graphics();
    const palette = {
      h: 0x8b5e3c, // brown hair
      H: 0x5c3310, // dark hair edge
      s: 0xffdaac, // skin
      e: 0xffffff, // eye white
      p: 0x222244, // pupil
      n: 0xd4a574, // nose shadow
      m: 0xcc7766, // mouth
      b: 0x3366bb, // blue tunic
      B: 0x224488, // dark blue tunic
      c: 0xbbbbbb, // collar
      T: 0x8b6914, // belt
      G: 0xaaaaaa, // sword gray
      d: 0x333355, // dark pants
      o: 0x6b3410, // boots
      O: 0x4a240a, // boot dark
    };
    /* 24 chars wide × 24 rows */
    const map = [
      '........hhhh...........',
      '.......hhhhhh..........',
      '......Hhhhhhhh.........',
      '......Hhhhhhhhh........',
      '......HhhhhhhhH........',
      '.......ssssssss........',
      '.......seesseess.......',
      '.......sppssppss.......',
      '.......sssnssss........',
      '........smmmss.........',
      '........ssssss.........',
      '.........cccc..........',
      '........bBBBBb.........',
      '.......bBBBBBBb........',
      '......ssbBBBBbss.......',
      '......ssbBBBBbss.......',
      '.......bBBBBBBb........',
      '.......bTTGTTb.........',
      '........ddddddd........',
      '.......ddd..ddd........',
      '.......ddd..ddd........',
      '.......ooo..ooo........',
      '.......OoO..OoO........',
      '........................',
    ];
    this.drawPixelArt(gfx, map, palette);
    gfx.generateTexture('player', 24, 24);
    gfx.destroy();
  }

  // ─── MONSTERS ─────────────────────────────────────────────────────────

  generateMonsterTexture(monsterId, data) {
    const size = data.size;

    const gfx = this.add.graphics();

    // Pixel art is drawn at scale=2 to fill the doubled texture size
    switch (monsterId) {
      case 'slime_01':
        this.drawSlime(gfx, 2);
        break;
      case 'goblin_01':
        this.drawGoblin(gfx, 2);
        break;
      case 'wolf_01':
        this.drawWolf(gfx, 2);
        break;
      case 'orc_01':
        this.drawOrc(gfx, 2);
        break;
      case 'dragon_01':
        this.drawDragon(gfx, 2);
        break;
      default:
        this.drawFallbackMonster(gfx, size, data.color);
        break;
    }

    gfx.generateTexture(`monster_${monsterId}`, size, size);
    gfx.destroy();
  }

  /* Slime — green blob with gel highlight */
  drawSlime(gfx, scale = 1) {
    const palette = {
      g: 0x228833, // dark green outline
      G: 0x44cc55, // green body
      L: 0x66ee77, // light green
      w: 0xeeffee, // white highlight
      e: 0x222222, // eye
      m: 0x228833, // mouth
    };
    const map = [
      '................',
      '......ggg.......',
      '....ggGGGgg.....',
      '...gGwwGGGGg....',
      '..gGwwGGGGGGg...',
      '..gGLGGGGGGGg...',
      '.gGGGGGGGGGGGg..',
      '.gGGeGGGGeGGGg..',
      '.gGGGGGGGGGGGg..',
      '.gGGGGGGGGGGGg..',
      '..gGGmmmGGGGg...',
      '..gGGGGGGGGGg...',
      '...gGGGGGGGg....',
      '....ggGGGGgg....',
      '.....gggggg.....',
      '................',
    ];
    this.drawPixelArt(gfx, map, palette, scale);
  }

  /* Goblin — green humanoid with club and pointy ears */
  drawGoblin(gfx, scale = 1) {
    const palette = {
      g: 0x44aa44, // green skin
      G: 0x337733, // dark green
      e: 0x66cc66, // ear inner
      r: 0xff2222, // red eyes
      b: 0x8b6914, // brown vest
      B: 0x6b4914, // dark vest
      c: 0x886633, // club
      C: 0x664422, // club dark
      d: 0x554433, // pants
      o: 0x443322, // boots
      t: 0xeeeecc, // teeth
      n: 0x337733, // nose dot
      s: 0x55bb55, // light skin
    };
    const map = [
      '....................',
      '........GG..........',
      '.......GGGG.........',
      '......gggggg........',
      '..e..ggssggg..e.....',
      '.ee.ggrgsgrgg.ee....',
      '.ee..ggsggg..ee.....',
      '......ggngg.........',
      '.......gttg.........',
      '........gg..........',
      '.......bbbbb........',
      '......bBBBBBb.......',
      '.....ggBBBBBgg......',
      '.....ggBBBBBggCc....',
      '......bbbbbbb.Cc....',
      '.......ggggg........',
      '......dd..dd........',
      '......dd..dd........',
      '......oo..oo........',
      '....................',
    ];
    this.drawPixelArt(gfx, map, palette, scale);
  }

  /* Wolf — gray wolf front-facing, pointed ears, teeth */
  drawWolf(gfx, scale = 1) {
    const palette = {
      g: 0x778899, // gray fur
      G: 0x556677, // dark gray
      l: 0xaabbcc, // light belly
      w: 0xccccdd, // white
      e: 0xffcc22, // yellow eye
      n: 0x222222, // nose
      t: 0xffffff, // teeth
      d: 0x445566, // dark fur
    };
    const map = [
      '......................',
      '....dd......dd........',
      '...dggd....dggd.......',
      '...dGGd....dGGd.......',
      '..dgggggggggggd.......',
      '..dGGGGGGGGGGGd......',
      '..dGGeGGGGGeGGd......',
      '..dGGGGGGGGGGGd......',
      '...dGGGnnGGGGd.......',
      '...dGGGGGGGGGd.......',
      '....dGGttttGGd........',
      '....dggggggggd........',
      '...dGGGGGGGGGGd......',
      '..dGGGGGGGGGGGGd.....',
      '..dGGllllllGGGGd.....',
      '..dGGllllllGGGGd.....',
      '...dGGGGGGGGGGd......',
      '...dGGd..dGGd........',
      '...dgGd..dgGd........',
      '....dd....dd..........',
      '......................',
      '......................',
    ];
    this.drawPixelArt(gfx, map, palette, scale);
  }

  /* Orc — large green warrior with armor and axe */
  drawOrc(gfx, scale = 1) {
    const palette = {
      g: 0x557744, // green skin
      G: 0x3d5530, // dark green
      s: 0x668855, // light green skin
      r: 0xff2222, // red eyes
      t: 0xeeeecc, // tusks
      a: 0x665544, // armor
      A: 0x443322, // dark armor
      w: 0x999999, // weapon
      W: 0x777777, // weapon dark
      d: 0x554433, // pants
      o: 0x443322, // boots
      h: 0x333322, // hair
      n: 0x3d5530, // nose
      m: 0x442222, // mouth
    };
    const map = [
      '..........................',
      '..........hhhh............',
      '.........hhhhhh...........',
      '........hggggggh..........',
      '........gggggggg..........',
      '.......gggggggggg.........',
      '......ggrggggrgggg........',
      '......ggggggggggg.........',
      '......ggggngggggg.........',
      '.......tgmmmggt...........',
      '........gggggg............',
      '.........gssg..............',
      '........aAAAAa............',
      '.......aAAAAAAa...........',
      '......ggAAAAAAgg..........',
      '.....gggAAAAAAggww........',
      '......gaAAAAAAagWw........',
      '.......aAAAAAa...........',
      '........aaaaaa............',
      '.........ggggg............',
      '........dd..dd............',
      '........dd..dd............',
      '........dd..dd............',
      '........oo..oo............',
      '........oo..oo............',
      '..........................',
    ];
    this.drawPixelArt(gfx, map, palette, scale);
  }

  /* Dragon — red dragon with wings, horns, fire */
  drawDragon(gfx, scale = 1) {
    const palette = {
      r: 0xcc2222, // red body
      R: 0x881111, // dark red
      o: 0xff9933, // orange belly
      O: 0xffcc44, // light orange
      w: 0xcc4444, // wing membrane
      W: 0x881122, // wing frame
      e: 0xffee22, // yellow eye
      f: 0xff6600, // fire
      F: 0xffcc00, // fire bright
      t: 0xffffff, // teeth
      h: 0x661111, // horns
      n: 0x441111, // nostril
      d: 0x991111, // darker red
    };
    const map = [
      '..............................',
      '....h.............h...........',
      '...hh.............hh..........',
      '...hrrrrrrrrrrrrrrhh..........',
      '....rrrrrrrrrrrrrr............',
      'W..rrrrrrrrrrrrrrrrr..W.......',
      'Ww.rrrRerrrrrRerrrrr.wW.......',
      'Wwwrrrrrrrrrrrrrrrrrwww.......',
      'WwwrrrrrrrnrrrrrrrrrwwW.......',
      '.WwwrrrrrrrrrrrrrrwwwW........',
      '..WwwrrrttttrrrrwwwW..........',
      '...WwwrrrrrrrrrwwwW...........',
      '....WwrrrrrrrrrrW.............',
      '.....rrrooooorrrr.............',
      '....rrrroooooorrrrr...........',
      '...rrrrroooooorrrrrr..........',
      '...rrrrroooooorrrrr...........',
      '....rrrrroooorrrr.............',
      '.....rrrrrrrrrrr..............',
      '......rrrrrrrrrr..............',
      '.......rrddrrddrr.............',
      '.......rrd..rrd...............',
      '........rd...rd...............',
      '........rd...rdddd............',
      '.........d....ddddd...........',
      '..............ddddd...........',
      '...............dddd...........',
      '................dd............',
      '..............................',
      '..............................',
    ];
    this.drawPixelArt(gfx, map, palette, scale);

    // Add fire breath particles (scaled)
    const s = scale;
    gfx.fillStyle(0xff6600, 0.8);
    gfx.fillRect(10 * s, 10 * s, 2 * s, 2 * s);
    gfx.fillRect(7 * s, 8 * s, 2 * s, 2 * s);
    gfx.fillRect(12 * s, 7 * s, 2 * s, 2 * s);
    gfx.fillStyle(0xffcc00, 0.8);
    gfx.fillRect(9 * s, 7 * s, 2 * s, 2 * s);
    gfx.fillRect(5 * s, 9 * s, 2 * s, 2 * s);
  }

  /* Fallback for unknown monster types */
  drawFallbackMonster(gfx, size, color) {
    gfx.fillStyle(color, 1);
    gfx.fillRect(2, 2, size - 4, size - 4);
    gfx.lineStyle(1, 0x440000, 1);
    gfx.strokeRect(1, 1, size - 2, size - 2);
    const eyeSize = Math.max(2, Math.floor(size / 8));
    const eyeY = Math.floor(size * 0.3);
    gfx.fillStyle(0xffff00, 1);
    gfx.fillRect(Math.floor(size * 0.25), eyeY, eyeSize, eyeSize);
    gfx.fillRect(Math.floor(size * 0.65), eyeY, eyeSize, eyeSize);
  }

  // ─── NPCs (24×24 each) ───────────────────────────────────────────────

  generateNPCTexture(npcId, data) {
    const gfx = this.add.graphics();

    switch (npcId) {
      case 'npc_elder':
        this.drawElder(gfx);
        break;
      case 'npc_blacksmith':
        this.drawBlacksmith(gfx);
        break;
      case 'npc_merchant':
        this.drawMerchant(gfx);
        break;
      case 'npc_healer':
        this.drawHealer(gfx);
        break;
      default:
        this.drawFallbackNPC(gfx, data.color);
        break;
    }

    gfx.generateTexture(`npc_${npcId}`, 24, 24);
    gfx.destroy();
  }

  /* Elder — white hair, brown robe, walking staff */
  drawElder(gfx) {
    const palette = {
      w: 0xdddddd, // white hair
      W: 0xbbbbbb, // gray hair shadow
      s: 0xffdaac, // skin
      e: 0xffffff, // eye white
      p: 0x222244, // pupil
      m: 0xcc8877, // mouth
      b: 0xdddddd, // white beard
      r: 0x7a5c3a, // brown robe
      R: 0x5a3c2a, // dark robe
      c: 0x8b7355, // collar
      S: 0x887744, // staff
      T: 0x665533, // staff dark
      o: 0x5a3c2a, // shoes
    };
    const map = [
      '........wwww............',
      '.......wwwwww...........',
      '......Wwwwwwww..........',
      '......Wwwwwwww..........',
      '.......ssssssss.........',
      '.......seesseess........',
      '.......sppssppss........',
      '.......ssssssss.........',
      '.......ssmmsss..........',
      '........bbbbbb..........',
      '........bbbbbb..........',
      '........cccccc..........',
      '.......rRRRRRRr.........',
      '......rRRRRRRRRr........',
      '......srRRRRRRrs.S......',
      '......srRRRRRRrs.S......',
      '.......rRRRRRRr..S......',
      '.......rRRRRRRr..S......',
      '........rrrrrr...S......',
      '........rrrrrr..SS......',
      '.......rr...rr..........',
      '.......rr...rr..........',
      '.......oo...oo..........',
      '........................',
    ];
    this.drawPixelArt(gfx, map, palette);
  }

  /* Blacksmith — bald/short hair, leather apron, muscular arms */
  drawBlacksmith(gfx) {
    const palette = {
      h: 0x443322, // dark short hair
      s: 0xddbb88, // tanned skin
      S: 0xcc9966, // skin shadow
      e: 0xffffff, // eye white
      p: 0x222222, // pupil
      m: 0xcc8877, // mouth
      a: 0x8b6914, // leather apron
      A: 0x6b4914, // dark apron
      t: 0xcccccc, // shirt under
      H: 0x888888, // hammer head
      w: 0x886633, // hammer handle
      d: 0x554433, // pants
      o: 0x443322, // boots
    };
    const map = [
      '........................',
      '........hhhh............',
      '.......hhhhhh...........',
      '.......hhhhhh...........',
      '.......ssssssss.........',
      '.......seesseess........',
      '.......sppssppss........',
      '.......ssssssss.........',
      '........smmsss..........',
      '........ssssss..........',
      '.........tttt...........',
      '........aAAAAa..........',
      '.......aAAAAAa..........',
      '......ssaAAAAass........',
      '......ssaAAAAass........',
      '.......aAAAAAa..........',
      '.......aAAAAAa..........',
      '........aaaaaaw.........',
      '........ddddddw.........',
      '.......ddd..ddH.........',
      '.......ddd..dd..........',
      '.......ooo..ooo.........',
      '.......ooo..ooo.........',
      '........................',
    ];
    this.drawPixelArt(gfx, map, palette);
  }

  /* Merchant — purple hat, green outfit, pouch */
  drawMerchant(gfx) {
    const palette = {
      h: 0x7733aa, // purple hat
      H: 0x552288, // dark purple hat
      s: 0xffdaac, // skin
      e: 0xffffff, // eye white
      p: 0x222244, // pupil
      m: 0xcc7766, // mouth
      g: 0x33aa55, // green dress
      G: 0x228844, // dark green
      c: 0xddcc44, // gold collar/trim
      b: 0x886633, // bag/pouch
      B: 0x664422, // bag dark
      d: 0x228844, // lower dress
      o: 0x6b4422, // shoes
    };
    const map = [
      '.......hhhhhh...........',
      '......hhhhhhhh..........',
      '......HHHHHHHH..........',
      '.....HhhhhhhhHH.........',
      '.......ssssssss.........',
      '.......seesseess........',
      '.......sppssppss........',
      '.......ssssssss.........',
      '........smmsss..........',
      '........ssssss..........',
      '........cccccc..........',
      '.......gGGGGGGg.........',
      '......gGGGGGGGGg........',
      '......sgGGGGGGgs........',
      '......sgGGGGGGgs.bB.....',
      '.......gGGGGGGg..bB.....',
      '.......gGGGGGGg..........',
      '........dddddd..........',
      '........dddddd..........',
      '.......dd...dd..........',
      '.......dd...dd..........',
      '.......oo...oo..........',
      '........................',
      '........................',
    ];
    this.drawPixelArt(gfx, map, palette);
  }

  /* Healer — white robe with red cross, gentle face */
  drawHealer(gfx) {
    const palette = {
      h: 0xddaa66, // blonde hair
      H: 0xbb8844, // dark blonde
      s: 0xffdaac, // skin
      e: 0xffffff, // eye white
      p: 0x336699, // blue eyes
      m: 0xcc8888, // mouth (smile)
      w: 0xeeeedd, // white robe
      W: 0xccccbb, // white robe shadow
      r: 0xcc2222, // red cross
      c: 0xddddcc, // collar
      o: 0xccccbb, // shoes (white)
    };
    const map = [
      '........hhhh............',
      '.......hhhhhh...........',
      '......Hhhhhhhh..........',
      '......Hhhhhhhhh.........',
      '.......ssssssss.........',
      '.......seesseess........',
      '.......sppsppss.........',
      '.......ssssssss.........',
      '........smmsss..........',
      '........ssssss..........',
      '.........cccc...........',
      '........wWrWWw..........',
      '.......wWrrWWWw.........',
      '......swWrrrWWws........',
      '......swWWrWWWws........',
      '.......wWWWWWWw.........',
      '.......wWWWWWWw.........',
      '........wwwwww..........',
      '........wwwwww..........',
      '.......ww...ww..........',
      '.......ww...ww..........',
      '.......oo...oo..........',
      '........................',
      '........................',
    ];
    this.drawPixelArt(gfx, map, palette);
  }

  /* Fallback NPC */
  drawFallbackNPC(gfx, color) {
    gfx.fillStyle(color, 1);
    gfx.fillRect(4, 2, 16, 20);
    gfx.lineStyle(1, 0x112244, 1);
    gfx.strokeRect(4, 2, 16, 20);
    gfx.fillStyle(0xffffff, 1);
    gfx.fillRect(7, 7, 3, 3);
    gfx.fillRect(14, 7, 3, 3);
    gfx.fillStyle(0x000000, 1);
    gfx.fillRect(8, 8, 2, 2);
    gfx.fillRect(15, 8, 2, 2);
  }

  // ─── GROUND TEXTURE (1600×1200) ──────────────────────────────────────

  generateGroundTexture() {
    const width = 1600;
    const height = 1200;
    const tileSize = 32;
    const gfx = this.add.graphics();

    // ── 1. Grass base with tile variation ──
    for (let x = 0; x < width; x += tileSize) {
      for (let y = 0; y < height; y += tileSize) {
        const v = Math.random() * 0.15;
        const r = Math.floor(0x33 * (1 + v));
        const g = Math.floor(0x88 * (1 - v * 0.3));
        const b = Math.floor(0x33 * (1 + v * 0.5));
        gfx.fillStyle((r << 16) | (g << 8) | b, 1);
        gfx.fillRect(x, y, tileSize, tileSize);
      }
    }

    // ── 2. Zone tints ──
    // Village area — warm green
    gfx.fillStyle(0x558844, 0.25);
    gfx.fillRect(300, 180, 480, 440);

    // Slime area — slight green-yellow
    gfx.fillStyle(0x445522, 0.12);
    gfx.fillRect(80, 80, 280, 520);

    // Goblin/wolf area — darker earth
    gfx.fillStyle(0x443322, 0.15);
    gfx.fillRect(800, 180, 380, 420);

    // Orc/dragon area — reddish earth
    gfx.fillStyle(0x442222, 0.18);
    gfx.fillRect(1050, 500, 500, 650);

    // ── 3. Grass tufts and flowers ──
    for (let i = 0; i < 200; i++) {
      const fx = Math.random() * width;
      const fy = Math.random() * height;
      // Dark grass tufts
      gfx.fillStyle(0x226622, 0.6);
      gfx.fillRect(fx, fy, 3, 2);
      gfx.fillRect(fx + 1, fy - 1, 1, 1);
    }
    // Small flowers
    const flowerColors = [0xffee44, 0xff6688, 0xeeeeff, 0xff9944];
    for (let i = 0; i < 80; i++) {
      const fx = Math.random() * width;
      const fy = Math.random() * height;
      const fc = flowerColors[Math.floor(Math.random() * flowerColors.length)];
      gfx.fillStyle(fc, 0.7);
      gfx.fillRect(fx, fy, 2, 2);
      gfx.fillStyle(fc, 0.4);
      gfx.fillRect(fx - 1, fy, 1, 1);
      gfx.fillRect(fx + 2, fy, 1, 1);
    }

    // ── 4. Stone-paved paths ──
    this.drawStonePath(gfx, 0, 280, width, 40, true); // horizontal
    this.drawStonePath(gfx, 480, 0, 40, height, false); // vertical
    this.drawStonePath(gfx, 0, 560, width, 40, true); // horizontal lower
    this.drawStonePath(gfx, 800, 280, 40, 280, false); // connector

    // ── 5. Village fence ──
    gfx.lineStyle(2, 0x886644, 0.8);
    // Top fence
    for (let fx = 305; fx < 775; fx += 12) {
      gfx.fillStyle(0x886644, 0.9);
      gfx.fillRect(fx, 185, 2, 10);
      gfx.fillRect(fx + 4, 185, 2, 10);
    }
    gfx.fillStyle(0x997755, 0.7);
    gfx.fillRect(305, 188, 470, 2);
    gfx.fillRect(305, 193, 470, 2);
    // Bottom fence
    for (let fx = 305; fx < 775; fx += 12) {
      gfx.fillStyle(0x886644, 0.9);
      gfx.fillRect(fx, 610, 2, 10);
      gfx.fillRect(fx + 4, 610, 2, 10);
    }
    gfx.fillStyle(0x997755, 0.7);
    gfx.fillRect(305, 613, 470, 2);
    gfx.fillRect(305, 618, 470, 2);
    // Left fence
    for (let fy = 190; fy < 615; fy += 12) {
      gfx.fillStyle(0x886644, 0.9);
      gfx.fillRect(302, fy, 2, 10);
    }
    gfx.fillStyle(0x997755, 0.7);
    gfx.fillRect(302, 195, 2, 83); // left upper (stop before path)
    gfx.fillRect(302, 322, 2, 236); // left middle
    gfx.fillRect(302, 602, 2, 16);  // left lower
    // Right fence
    for (let fy = 190; fy < 615; fy += 12) {
      gfx.fillStyle(0x886644, 0.9);
      gfx.fillRect(775, fy, 2, 10);
    }
    gfx.fillStyle(0x997755, 0.7);
    gfx.fillRect(775, 195, 2, 83);
    gfx.fillRect(775, 322, 2, 236);
    gfx.fillRect(775, 602, 2, 16);

    // ── 6. Village buildings ──
    this.drawBuilding(gfx, 340, 220, 60, 45, 0xbb8855, 0x884422, 0x66aadd); // house 1
    this.drawBuilding(gfx, 450, 350, 70, 50, 0xaa7744, 0x773311, 0xffdd66); // house 2
    this.drawBuilding(gfx, 600, 230, 55, 40, 0xcc9966, 0x885533, 0x88ccee); // house 3
    this.drawBuilding(gfx, 680, 450, 65, 48, 0xbb8855, 0x773311, 0xffcc44); // house 4

    // ── 7. Trees ──
    const treePositions = [
      [120, 60], [750, 130], [1500, 60], [110, 1050],
      [600, 700], [1400, 380], [320, 880], [980, 110],
      [1280, 280], [220, 700], [880, 780], [1100, 180],
      [160, 400], [420, 800], [1050, 420], [1350, 600],
    ];
    for (const [tx, ty] of treePositions) {
      this.drawTree(gfx, tx, ty);
    }

    // ── 8. Pond in village area ──
    this.drawPond(gfx, 560, 510, 50, 30);

    // ── 9. Well in village center ──
    // Stone base
    gfx.fillStyle(0x888888, 0.9);
    gfx.fillCircle(530, 380, 10);
    gfx.fillStyle(0x555577, 0.9);
    gfx.fillCircle(530, 380, 7);
    gfx.fillStyle(0x334466, 0.9);
    gfx.fillCircle(530, 380, 4);
    // Posts
    gfx.fillStyle(0x886633, 1);
    gfx.fillRect(524, 368, 2, 8);
    gfx.fillRect(534, 368, 2, 8);
    // Roof
    gfx.fillStyle(0x884422, 1);
    gfx.fillRect(522, 366, 16, 3);

    gfx.generateTexture('ground', width, height);
    gfx.destroy();
  }

  /** Draw a stone-paved path (alternating gray stone blocks) */
  drawStonePath(gfx, x, y, w, h, horizontal) {
    // Base path color
    gfx.fillStyle(0x888877, 1);
    gfx.fillRect(x, y, w, h);

    // Path edges
    gfx.fillStyle(0x777766, 1);
    if (horizontal) {
      gfx.fillRect(x, y, w, 3);
      gfx.fillRect(x, y + h - 3, w, 3);
    } else {
      gfx.fillRect(x, y, 3, h);
      gfx.fillRect(x + w - 3, y, 3, h);
    }

    // Stone blocks pattern
    const stoneW = horizontal ? 14 : w - 6;
    const stoneH = horizontal ? h - 6 : 14;
    const colors = [0x999988, 0xaaa999, 0x888877, 0x9a9a89];

    if (horizontal) {
      let sx = x + 2;
      let row = 0;
      while (sx < x + w) {
        const sw = stoneW + Math.floor(Math.random() * 6) - 3;
        const sy = y + 3;
        gfx.fillStyle(colors[(row++) % colors.length], 1);
        gfx.fillRect(sx, sy, sw - 1, stoneH);
        // Grout line (dark)
        gfx.fillStyle(0x666655, 0.6);
        gfx.fillRect(sx + sw - 1, sy, 1, stoneH);
        sx += sw;
      }
      // Horizontal grout in middle
      gfx.fillStyle(0x666655, 0.4);
      gfx.fillRect(x, y + Math.floor(h / 2), w, 1);
    } else {
      let sy = y + 2;
      let row = 0;
      while (sy < y + h) {
        const sh = stoneH + Math.floor(Math.random() * 6) - 3;
        const sx = x + 3;
        gfx.fillStyle(colors[(row++) % colors.length], 1);
        gfx.fillRect(sx, sy, stoneW, sh - 1);
        gfx.fillStyle(0x666655, 0.6);
        gfx.fillRect(sx, sy + sh - 1, stoneW, 1);
        sy += sh;
      }
      gfx.fillStyle(0x666655, 0.4);
      gfx.fillRect(x + Math.floor(w / 2), y, 1, h);
    }
  }

  /** Draw a small building with peaked roof, windows, door */
  drawBuilding(gfx, x, y, w, h, wallColor, roofColor, windowColor) {
    const roofH = Math.floor(h * 0.35);

    // Wall
    gfx.fillStyle(wallColor, 1);
    gfx.fillRect(x, y + roofH, w, h - roofH);

    // Wall outline
    gfx.lineStyle(1, 0x554433, 0.6);
    gfx.strokeRect(x, y + roofH, w, h - roofH);

    // Roof (triangle using filled rows)
    gfx.fillStyle(roofColor, 1);
    for (let ry = 0; ry < roofH; ry++) {
      const ratio = ry / roofH;
      const rw = w * ratio;
      const rx = x + (w - rw) / 2;
      gfx.fillRect(rx, y + ry, rw, 1);
    }

    // Roof overhang
    gfx.fillStyle(roofColor, 0.8);
    gfx.fillRect(x - 3, y + roofH - 1, w + 6, 3);

    // Windows
    const winW = Math.floor(w * 0.15);
    const winH = Math.floor((h - roofH) * 0.3);
    const winY = y + roofH + Math.floor((h - roofH) * 0.2);

    gfx.fillStyle(windowColor, 0.8);
    gfx.fillRect(x + Math.floor(w * 0.15), winY, winW, winH);
    gfx.fillRect(x + Math.floor(w * 0.65), winY, winW, winH);

    // Window cross bars
    gfx.fillStyle(0x554433, 0.6);
    gfx.fillRect(
      x + Math.floor(w * 0.15),
      winY + Math.floor(winH / 2),
      winW,
      1
    );
    gfx.fillRect(
      x + Math.floor(w * 0.15) + Math.floor(winW / 2),
      winY,
      1,
      winH
    );
    gfx.fillRect(
      x + Math.floor(w * 0.65),
      winY + Math.floor(winH / 2),
      winW,
      1
    );
    gfx.fillRect(
      x + Math.floor(w * 0.65) + Math.floor(winW / 2),
      winY,
      1,
      winH
    );

    // Door
    const doorW = Math.floor(w * 0.2);
    const doorH = Math.floor((h - roofH) * 0.55);
    const doorX = x + Math.floor((w - doorW) / 2);
    const doorY = y + h - doorH;

    gfx.fillStyle(0x664422, 1);
    gfx.fillRect(doorX, doorY, doorW, doorH);
    gfx.lineStyle(1, 0x443311, 0.8);
    gfx.strokeRect(doorX, doorY, doorW, doorH);

    // Door knob
    gfx.fillStyle(0xccaa44, 1);
    gfx.fillRect(doorX + doorW - 3, doorY + Math.floor(doorH / 2), 2, 2);
  }

  /** Draw a tree with trunk and leafy canopy */
  drawTree(gfx, x, y) {
    // Trunk
    gfx.fillStyle(0x6b4226, 1);
    gfx.fillRect(x - 3, y, 6, 14);
    gfx.fillStyle(0x7b5236, 0.7);
    gfx.fillRect(x - 2, y + 2, 2, 10);

    // Canopy (overlapping circles for fullness)
    gfx.fillStyle(0x227722, 0.9);
    gfx.fillCircle(x, y - 6, 14);
    gfx.fillStyle(0x339933, 0.8);
    gfx.fillCircle(x - 6, y - 3, 10);
    gfx.fillCircle(x + 7, y - 4, 11);
    gfx.fillStyle(0x44aa44, 0.6);
    gfx.fillCircle(x - 3, y - 10, 8);
    gfx.fillCircle(x + 4, y - 8, 9);

    // Highlight on top
    gfx.fillStyle(0x55bb55, 0.4);
    gfx.fillCircle(x - 2, y - 12, 5);
  }

  /** Draw a small pond with lighter edge */
  drawPond(gfx, x, y, rx, ry) {
    // Outer edge (lighter blue)
    gfx.fillStyle(0x5588bb, 0.6);
    gfx.fillEllipse(x, y, (rx + 4) * 2, (ry + 4) * 2);

    // Water body
    gfx.fillStyle(0x3366aa, 0.8);
    gfx.fillEllipse(x, y, rx * 2, ry * 2);

    // Highlight ripple
    gfx.fillStyle(0x6699cc, 0.5);
    gfx.fillEllipse(x - 5, y - 4, 20, 8);

    // Tiny highlight
    gfx.fillStyle(0x88bbdd, 0.6);
    gfx.fillEllipse(x - 10, y - 6, 8, 4);
  }
}
