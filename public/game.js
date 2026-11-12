/* 尸潮防线 — 原创竖屏据点防守 + 肉鸽构筑 demo (Phaser 3) */
(() => {
'use strict';

/* ============================== 常量 ============================== */
const W = 540, H = 960;
const RES = Math.min(2, Math.max(1, Math.ceil(window.devicePixelRatio || 1)));
const S = 1 / RES;
const WALL_Y = 800, HX = 270, HY = 872;
const WAVE_LEN = 20, MAXW = 30;
const BACKLOG_MAX = 25, BACKLOG_WAIT = 6;   // 场上存活过多时，下一波最多推迟几秒
const FONT = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC",sans-serif';
const qs = new URLSearchParams(location.search);
const BOT = qs.has('bot');
const START_SPEED = parseFloat(qs.get('speed')) || 1;
/* 难度曲线系数（可用 URL 参数覆盖，方便 bot 调参，如 ?bot&speed=20&hp1=.2） */
const qn = (k, d) => qs.has(k) ? parseFloat(qs.get(k)) : d;
const TUNE = {
  // 单只怪血量：1 + hp1·x + hp2·x² + hp3·x³（x = 波次-1）
  // 提高早期基数、压低三次项：小怪前期更有存在感，后期不再一夜暴涨
  hp1: qn('hp1', .26), hp2: qn('hp2', 0), hp3: qn('hp3', .0021),
  b1: qn('b1', 2.8), b2: qn('b2', .42),             // 每波预算：15 + b1·w + b2·w²
  xpw: qn('xpw', .03),                             // 怪物经验每波增长
  dmgw: qn('dmgw', .045),                          // 怪物攻击每波增长（太高会导致城墙瞬间崩盘）
};
if (BOT) window.__TUNE = TUNE;

const rnd = (a, b) => a + Math.random() * (b - a);
const rint = (a, b) => Math.floor(rnd(a, b + 1));
const pick = a => a[Math.floor(Math.random() * a.length)];
const css = n => '#' + n.toString(16).padStart(6, '0');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmtTime = t => { t = Math.floor(t); return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0'); };

/* ============================== 数据 ============================== */
const ET = {
  walker:  { name: '游荡者', hp: 26,  spd: 40, r: 18, armor: 0, dmg: 7,  xp: 1,   tex: 'e_walker' },
  runner:  { name: '疾行者', hp: 15,  spd: 92, r: 14, armor: 0, dmg: 5,  xp: 1,   tex: 'e_runner' },
  swarm:   { name: '虫群',   hp: 8,   spd: 78, r: 10, armor: 0, dmg: 2.5, xp: .4, tex: 'e_swarm' },
  brute:   { name: '重装怪', hp: 165, spd: 26, r: 32, armor: 4, dmg: 26, xp: 6,   tex: 'e_brute', big: 1, bar: 1 },
  shield:  { name: '盾甲怪', hp: 78,  spd: 34, r: 22, armor: 7, dmg: 12, xp: 4,   tex: 'e_shield', bar: 1 },
  spitter: { name: '喷吐者', hp: 37,  spd: 42, r: 19, armor: 0, dmg: 10, xp: 3,   tex: 'e_spitter', ranged: 1 },
  elite:   { name: '精英重装', hp: 760, spd: 24, r: 40, armor: 5, dmg: 25, xp: 20,  tex: 'e_brute', big: 1, bar: 1, elite: 1, scale: 1.25 },
  boss1:   { name: '腐蚀巨兽', hp: 4500, spd: 15, r: 70, armor: 6, dmg: 52, xp: 100, tex: 'e_boss1', boss: 1, big: 1 },
  boss2:   { name: '灾厄之王', hp: 14000, spd: 14, r: 84, armor: 8, dmg: 88, xp: 200, tex: 'e_boss2', boss: 1, big: 1 },
};

const SKILLS = {
  frost: {
    name: '冰晶弹', glyph: '❄️', color: 0x2f8fd6,
    desc: ['发射冰晶，命中减速敌人', '冰晶 +1，扇形发射', '穿透 +1，减速更强', '冰晶 +1，伤害提升', '命中有 25% 几率冻结目标'],
    branches: {
      a: { key: 'a', name: '寒霜风暴', glyph: '🌨️', tag: '控制', desc: '冰晶 +1，额外释放半圆冰晶幕，冻结几率提升到 40%' },
      b: { key: 'b', name: '永冻碎晶', glyph: '💠', tag: '输出', desc: '冰晶命中后分裂成 3 片碎冰，并对减速或冻结目标造成 50% 额外伤害' },
    },
  },
  rail: {
    name: '电磁穿刺', glyph: '⚡', color: 0x7a5cff,
    desc: ['瞄准高血量目标，发射贯穿光束', '伤害提升', '无视目标护甲', '光束更宽，伤害提升', '同时发射 2 道光束'],
    branches: {
      a: { key: 'a', name: '超载轨道炮', glyph: '⚡', tag: '控制', desc: '同时发射 3 道强化光束，命中使目标眩晕 0.6 秒' },
      b: { key: 'b', name: '磁暴天罚', glyph: '🌌', tag: '输出', desc: '单道粗光束，伤害 +35%，落点留下 2.5 秒电磁场持续伤害' },
    },
  },
  fire: {
    name: '燃烧弹', glyph: '🔥', color: 0xe0642a,
    desc: ['投掷燃烧弹，爆炸后留下火焰地带', '爆炸范围扩大，伤害提升', '同时投掷 2 枚', '火焰持续更久，灼烧更痛', '火焰地带内的敌人被减速'],
    branches: {
      a: { key: 'a', name: '熔岩炸弹', glyph: '🔥', tag: '控制', desc: '3 枚巨型熔岩弹，范围 +55%，火焰持续 6 秒，离开后仍会灼烧' },
      b: { key: 'b', name: '炼狱火墙', glyph: '🧱', tag: '输出', desc: '落点生成 5 段纵向火墙，持续 5 秒，穿过火墙的敌人被减速并灼烧' },
    },
  },
  chain: {
    name: '闪电链', glyph: '🌩️', color: 0xd8b800,
    desc: ['电弧在敌人之间跳跃', '跳跃 +1，伤害提升', '35% 几率眩晕目标', '跳跃 +1，伤害提升', '电弧不再衰减，跳跃 +2'],
    branches: {
      a: { key: 'a', name: '雷暴', glyph: '🌩️', tag: '控制', desc: '同时放出 3 条电弧链，每次跳跃都会分叉' },
      b: { key: 'b', name: '万雷贯体', glyph: '🌪️', tag: '输出', desc: '锁定单体连续落雷 10 次，伤害递增并溅射，最后一击范围爆炸' },
    },
  },
  drone: {
    name: '战术无人机', glyph: '🤖', color: 0x2aa58a,
    desc: ['召唤 1 台无人机自动射击', '无人机伤害提升', '+1 台无人机', '无人机发射导弹', '+1 台无人机，射速提升'],
    branches: {
      a: { key: 'a', name: '守卫编队', glyph: '🤖', tag: '控制', desc: '4 台无人机，导弹更频繁，并持续修复城墙 5/秒' },
      b: { key: 'b', name: '死神蜂群', glyph: '🛸', tag: '输出', desc: '无人机锁定残血目标，射速 +35%，命中标记目标，使其受到伤害 +20%' },
    },
  },
  air: {
    name: '空投轰炸', glyph: '💣', color: 0xb8452e,
    desc: ['呼叫空投，延迟后爆炸', '伤害提升', '炸弹 +1', '爆炸范围扩大，附带眩晕', '炸弹 +2，伤害提升'],
    branches: {
      a: { key: 'a', name: '地毯轰炸', glyph: '💣', tag: '控制', desc: '沿敌群最密集的一列连续轰炸 10 次' },
      b: { key: 'b', name: '天罚轰击', glyph: '☄️', tag: '输出', desc: '单发巨型炸弹，范围 +140%，伤害 ×5，眩晕 1 秒并留下弹坑' },
    },
  },
};
const GUN_DESC = ['', '', '伤害 +25%', '弹匣容量 +6', '改为双发', '射速 +20%', '伤害 +25%', '换弹时间 -30%', '改为三发'];
const MAX_SKILL = 5, MAX_GUN = 8, SLOTS = 4;

/* 各技能每级数值：战斗逻辑与升级卡片共用同一份数据 */
const SKILL_STATS = {
  frost: l => ({ 伤害: 13 + 5 * (l - 1), 冰晶: [1, 2, 2, 3, 3][l - 1], 穿透: [1, 1, 2, 2, 2][l - 1], 减速: l >= 3 ? '50%' : '35%', 冻结: l >= 5 ? '25%' : '无' }),
  rail:  l => ({ 伤害: 46 + 18 * (l - 1), 光束: l >= 5 ? 2 : 1, 宽度: 28 + (l >= 4 ? 14 : 0), 无视护甲: l >= 3 ? '是' : '否', 冷却: 3.6 - .15 * l }),
  fire:  l => ({ 伤害: 24 + 9 * (l - 1), 范围: 66 + 6 * (l - 1), 数量: l >= 3 ? 2 : 1, 灼烧: 5 + 2 * (l - 1) + (l >= 4 ? 2 : 0), 持续: 3 + .4 * l }),
  chain: l => ({ 伤害: 17 + 6 * (l - 1), 跳跃: [3, 4, 4, 5, 7][l - 1] + 1, 眩晕: l >= 3 ? '35%' : '无', 衰减: l >= 5 ? '无' : '12%', 冷却: 2.5 - .1 * l }),
  drone: l => ({ 台数: [1, 1, 2, 2, 3][l - 1], 伤害: 5 + 2.5 * (l - 1), 射击间隔: l >= 5 ? .38 : .55, 导弹: l >= 4 ? '有' : '无' }),
  air:   l => ({ 伤害: (50 + 20 * (l - 1)) * (l >= 5 ? 1.1 : 1), 炸弹: [3, 3, 4, 4, 6][l - 1], 范围: 70 + (l >= 4 ? 18 : 0), 冷却: 6.6 - .3 * l }),
};
const fmtN = v => typeof v === 'number' ? String(Math.round(v * 10) / 10) : v;
function diffText(a, b) {
  const out = [];
  for (const k in b) {
    const nb = fmtN(b[k]);
    if (!a) out.push(`${k} ${nb}`);
    else if (fmtN(a[k]) !== nb) out.push(`${k} ${fmtN(a[k])}→${nb}`);
  }
  return out.join('  ');
}
const branchOf = (s) => s && s.br ? SKILLS[s.id].branches[s.br] : null;

/* ============================== 工具 ============================== */
function tex(sc, key, w, h, fn) {
  const g = sc.make.graphics({ x: 0, y: 0, add: false });
  g.scaleCanvas(RES, RES);
  fn(g);
  g.generateTexture(key, Math.ceil(w * RES), Math.ceil(h * RES));
  g.destroy();
}
function setupCam(sc) {
  const c = sc.cameras.main;
  c.setViewport(0, 0, W * RES, H * RES);
  c.setZoom(RES);
  c.centerOn(W / 2, H / 2);
}
function T(sc, x, y, str, size, color, o = {}) {
  return sc.add.text(x, y, str, Object.assign({
    fontFamily: FONT, fontSize: size + 'px', color: color || '#fff', fontStyle: 'bold', resolution: RES,
  }, o));
}

/* ============================== 音效（Web Audio 合成） ============================== */
const SFX = (() => {
  let ctx = null, master = null, nbuf = null, muted = false;
  try { muted = localStorage.getItem('zd_mute') === '1'; } catch (e) {}
  const last = {};
  function init() {
    if (!ctx) {
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        master = ctx.createGain(); master.gain.value = muted ? 0 : .55; master.connect(ctx.destination);
        nbuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const d = nbuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      } catch (e) { ctx = null; }
    }
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }
  function tone(f0, dur, type, vol, f1, delay) {
    if (!ctx) return;
    const t = ctx.currentTime + (delay || 0), o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + .02);
  }
  function noise(dur, vol, ftype, freq, delay) {
    if (!ctx) return;
    const t = ctx.currentTime + (delay || 0), s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = nbuf; f.type = ftype; f.frequency.value = freq;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(master); s.start(t, Math.random() * .5); s.stop(t + dur + .02);
  }
  const defs = {
    shoot: [70, () => { tone(620, .06, 'square', .05, 180); noise(.04, .04, 'highpass', 3000); }],
    hit: [45, () => noise(.035, .05, 'bandpass', 2500)],
    kill: [35, () => { tone(320, .09, 'triangle', .08, 110); }],
    boom: [70, () => { noise(.4, .32, 'lowpass', 500); tone(130, .35, 'sine', .3, 38); }],
    ice: [110, () => { tone(900, .12, 'sine', .07, 1500); tone(1350, .1, 'sine', .04, 2000, .03); }],
    rail: [200, () => { tone(1400, .35, 'sawtooth', .1, 70); noise(.3, .12, 'highpass', 1500); }],
    zap: [90, () => { noise(.18, .12, 'bandpass', 2200); tone(180, .15, 'square', .06, 90); }],
    toss: [150, () => tone(260, .25, 'sine', .08, 520)],
    whistle: [200, () => tone(1300, .7, 'sine', .06, 260)],
    drone: [90, () => tone(950, .04, 'square', .03, 700)],
    wall: [110, () => { noise(.18, .3, 'lowpass', 260); tone(90, .15, 'sine', .25, 50); }],
    spit: [200, () => tone(240, .2, 'sawtooth', .05, 520)],
    levelup: [0, () => [523, 659, 784, 1047].forEach((f, i) => tone(f, .16, 'triangle', .13, 0, i * .07))],
    select: [0, () => { tone(520, .09, 'square', .07, 880); }],
    evo: [0, () => { [392, 523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, .25, 'sawtooth', .08, 0, i * .06)); noise(.5, .15, 'highpass', 2000); }],
    wave: [0, () => { tone(180, .3, 'triangle', .15, 120); tone(240, .3, 'triangle', .12, 160, .15); }],
    boss: [0, () => { tone(80, .9, 'sawtooth', .2, 50); tone(120, .9, 'square', .1, 60); noise(.8, .18, 'lowpass', 300); }],
    win: [0, () => [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, .3, 'triangle', .15, 0, i * .12))],
    lose: [0, () => [392, 330, 262, 196].forEach((f, i) => tone(f, .45, 'sawtooth', .1, 0, i * .22))],
  };
  return {
    init,
    play(name) {
      if (!ctx || muted) return;
      const d = defs[name]; if (!d) return;
      const now = performance.now();
      if (now - (last[name] || 0) < d[0]) return;
      last[name] = now; d[1]();
    },
    get muted() { return muted; },
    toggle() {
      muted = !muted; try { localStorage.setItem('zd_mute', muted ? '1' : '0'); } catch (e) {}
      if (master) master.gain.value = muted ? 0 : .55;
      init(); return muted;
    },
  };
})();
['pointerdown', 'touchstart', 'keydown'].forEach(ev => window.addEventListener(ev, SFX.init, { passive: true }));

/* ============================== 贴图生成 ============================== */
class Boot extends Phaser.Scene {
  constructor() { super('Boot'); }
  create() {
    const s = this;
    // 地面
    tex(s, 'bg', W, H, g => {
      g.fillStyle(0x23262c); g.fillRect(0, 0, W, H);
      const Tz = 60;
      for (let y = 0; y < H / Tz; y++) for (let x = 0; x < W / Tz; x++) {
        const v = ((x * 7 + y * 13) % 5) * 3;
        g.fillStyle(Phaser.Display.Color.GetColor(38 + v, 41 + v, 47 + v));
        g.fillRect(x * Tz + 1, y * Tz + 1, Tz - 2, Tz - 2);
      }
      g.lineStyle(2, 0x1a1c21, .8);
      for (let i = 0; i < 26; i++) {
        const x = rnd(0, W), y = rnd(0, H), a = rnd(0, 6.28), l = rnd(20, 60);
        g.lineBetween(x, y, x + Math.cos(a) * l, y + Math.sin(a) * l);
      }
      // 路面警示线
      g.fillStyle(0x4a4326, .55);
      for (let y = 20; y < WALL_Y; y += 70) { g.fillRect(W / 2 - 4, y, 8, 34); }
      // 污渍
      for (let i = 0; i < 12; i++) { g.fillStyle(0x15171b, rnd(.08, .2)); g.fillCircle(rnd(0, W), rnd(0, H), rnd(20, 60)); }
    });
    // 前线工事
    tex(s, 'fort', W, H - WALL_Y, g => {
      const h = H - WALL_Y;
      g.fillStyle(0x2b2f36); g.fillRect(0, 0, W, h);
      g.fillStyle(0x5a626f); g.fillRect(0, 0, W, 26);
      g.fillStyle(0x8a94a3); g.fillRect(0, 0, W, 4);
      g.fillStyle(0x3d434d); g.fillRect(0, 22, W, 6);
      for (let x = -20; x < W + 20; x += 34) {
        g.fillStyle(0xd9a521);
        g.fillPoints([{ x: x, y: 28 }, { x: x + 17, y: 28 }, { x: x + 7, y: 44 }, { x: x - 10, y: 44 }], true);
        g.fillStyle(0x15171b);
        g.fillPoints([{ x: x + 17, y: 28 }, { x: x + 34, y: 28 }, { x: x + 24, y: 44 }, { x: x + 7, y: 44 }], true);
      }
      g.fillStyle(0x1e2228); g.fillRect(0, 44, W, h - 44);
      g.lineStyle(2, 0x2d323a);
      for (let x = 0; x <= W; x += 60) g.lineBetween(x, 44, x, h);
      for (let y = 74; y < h; y += 40) g.lineBetween(0, y, W, y);
      g.fillStyle(0x6d7684);
      for (let x = 20; x < W; x += 60) { g.fillCircle(x, 12, 3); }
    });
    // 敌人
    const enemy = (key, sz, body, dark, glow, o = {}) => tex(s, key, sz, sz, g => {
      const c = sz / 2;
      g.fillStyle(dark); g.fillEllipse(c, c, sz * .88, sz * .92);
      g.fillStyle(body); g.fillEllipse(c, c - 1, sz * .76, sz * .8);
      g.fillStyle(dark);
      g.fillCircle(c - sz * .4, c + sz * .16, sz * .12); g.fillCircle(c + sz * .4, c + sz * .16, sz * .12);
      if (o.claws) { g.fillStyle(glow); g.fillCircle(c - sz * .42, c + sz * .26, sz * .06); g.fillCircle(c + sz * .42, c + sz * .26, sz * .06); }
      if (o.spikes) { g.fillStyle(dark); for (let i = -2; i <= 2; i++) g.fillTriangle(c + i * sz * .15 - 5, c - sz * .3, c + i * sz * .15 + 5, c - sz * .3, c + i * sz * .15, c - sz * .46); }
      g.fillStyle(body); g.fillCircle(c, c + sz * .2, sz * .23);
      g.lineStyle(2, dark); g.strokeCircle(c, c + sz * .2, sz * .23);
      g.fillStyle(glow); g.fillCircle(c - sz * .09, c + sz * .24, sz * .055); g.fillCircle(c + sz * .09, c + sz * .24, sz * .055);
      if (o.shield) {
        g.fillStyle(0x7f93a8); g.fillRoundedRect(c - sz * .38, c + sz * .3, sz * .76, sz * .15, 5);
        g.fillStyle(0xaec1d6); g.fillRoundedRect(c - sz * .34, c + sz * .31, sz * .68, sz * .05, 3);
      }
      if (o.bulb) { g.fillStyle(0x9be04a); g.fillCircle(c, c - sz * .12, sz * .18); g.fillStyle(0xd7ff8a, .7); g.fillCircle(c - 3, c - sz * .16, sz * .07); }
      if (o.plates) { g.fillStyle(0x4a3f58); g.fillRoundedRect(c - sz * .3, c - sz * .22, sz * .6, sz * .22, 6); }
    });
    enemy('e_walker', 44, 0x6b8a6a, 0x34493a, 0xfff06a, { claws: 1 });
    enemy('e_runner', 36, 0xa4574a, 0x5a2b27, 0xffe36a, { claws: 1 });
    enemy('e_swarm', 24, 0x8a6a9c, 0x44304f, 0xffffff);
    enemy('e_brute', 78, 0x7a5c8c, 0x3a2a47, 0xff6a5a, { spikes: 1, plates: 1, claws: 1 });
    enemy('e_shield', 56, 0x5f7690, 0x2c3948, 0x7fe0ff, { shield: 1 });
    enemy('e_spitter', 50, 0x6a8f3c, 0x30451c, 0xffd36a, { bulb: 1 });
    enemy('e_boss1', 160, 0x8a4a3a, 0x3c1f1a, 0xff7a3a, { spikes: 1, plates: 1, claws: 1 });
    enemy('e_boss2', 190, 0x5a3a78, 0x241438, 0xff3a6a, { spikes: 1, plates: 1, claws: 1, bulb: 1 });
    // 英雄（向上）
    tex(s, 'hero', 64, 72, g => {
      g.fillStyle(0x15191f); g.fillRect(26, 2, 12, 34);
      g.fillStyle(0x3a424d); g.fillRect(28, 0, 8, 30);
      g.fillStyle(0x2f4f3a); g.fillEllipse(32, 44, 46, 26);
      g.fillStyle(0x3f6a4c); g.fillEllipse(32, 43, 40, 22);
      g.fillStyle(0xcaa27a); g.fillCircle(32, 44, 9);
      g.fillStyle(0x4a5666); g.fillCircle(32, 43, 10);
      g.fillStyle(0x6c7c90); g.fillCircle(32, 41, 6);
      g.fillStyle(0x2f4f3a); g.fillCircle(14, 40, 6); g.fillCircle(50, 40, 6);
    });
    tex(s, 'drone', 30, 30, g => {
      g.fillStyle(0x203a40); g.fillCircle(15, 15, 13);
      g.fillStyle(0x2aa58a); g.fillCircle(15, 15, 10);
      g.fillStyle(0xbdf5e6); g.fillCircle(15, 15, 4);
      g.lineStyle(2, 0x9ad8c8, .8); g.strokeCircle(15, 15, 13);
      g.fillStyle(0x15191f); g.fillRect(13, 0, 4, 8);
    });
    // 子弹
    tex(s, 'b_main', 8, 20, g => { g.fillStyle(0xffe27a, .35); g.fillRoundedRect(0, 0, 8, 20, 4); g.fillStyle(0xfff3b0); g.fillRoundedRect(2, 2, 4, 16, 2); });
    tex(s, 'b_ice', 14, 28, g => {
      g.fillStyle(0x6ad0ff, .35); g.fillTriangle(7, 0, 14, 20, 0, 20);
      g.fillStyle(0xcff3ff); g.fillTriangle(7, 2, 12, 20, 2, 20);
      g.fillStyle(0x6ad0ff); g.fillTriangle(7, 28, 11, 18, 3, 18);
    });
    tex(s, 'b_drone', 8, 16, g => { g.fillStyle(0x66ffd8, .4); g.fillRoundedRect(0, 0, 8, 16, 4); g.fillStyle(0xd5fff4); g.fillRoundedRect(2, 2, 4, 12, 2); });
    tex(s, 'spit', 16, 16, g => { g.fillStyle(0x7fd04a, .5); g.fillCircle(8, 8, 8); g.fillStyle(0xc8ff7a); g.fillCircle(8, 8, 5); });
    tex(s, 'shell', 18, 18, g => { g.fillStyle(0xffb060, .5); g.fillCircle(9, 9, 9); g.fillStyle(0xffe0a0); g.fillCircle(9, 9, 5); });
    tex(s, 'dot', 8, 8, g => { g.fillStyle(0xffffff); g.fillCircle(4, 4, 4); });
    tex(s, 'glow', 128, 128, g => { for (let i = 32; i >= 1; i--) { g.fillStyle(0xffffff, .045); g.fillCircle(64, 64, 64 * i / 32); } });
    tex(s, 'ring', 128, 128, g => { g.lineStyle(10, 0xffffff, .25); g.strokeCircle(64, 64, 58); g.lineStyle(4, 0xffffff, 1); g.strokeCircle(64, 64, 58); });
    tex(s, 'chest', 48, 40, g => {
      g.fillStyle(0x4a2a12); g.fillRoundedRect(2, 12, 44, 26, 4);
      g.fillStyle(0x8a5424); g.fillRoundedRect(4, 14, 40, 22, 3);
      g.fillStyle(0x6a3c18); g.fillRoundedRect(2, 2, 44, 14, { tl: 10, tr: 10, bl: 2, br: 2 });
      g.fillStyle(0xffd45a); g.fillRect(2, 14, 44, 4); g.fillRect(21, 2, 6, 36);
      g.fillStyle(0xfff3b0); g.fillRect(20, 16, 8, 8);
    });
    tex(s, 'shadow', 64, 32,g => { g.fillStyle(0x000000, .35); g.fillEllipse(32, 16, 60, 26); });
    this.scene.start('Menu');
  }
}

/* ============================== 菜单 ============================== */
class Menu extends Phaser.Scene {
  constructor() { super('Menu'); }
  create() {
    setupCam(this);
    this.add.image(W / 2, H / 2, 'bg').setScale(S);
    this.add.image(W / 2, WALL_Y + (H - WALL_Y) / 2, 'fort').setScale(S).setDepth(2);
    this.add.image(HX, HY, 'hero').setScale(S).setDepth(3);
    const glow = this.add.image(W / 2, 250, 'glow').setDisplaySize(520, 520).setTint(0xff6a3a).setAlpha(.5).setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({ targets: glow, alpha: .25, duration: 1400, yoyo: true, repeat: -1 });
    T(this, W / 2, 210, '尸潮防线', 86, '#ffd45a', { stroke: '#3a1a08', strokeThickness: 12 }).setOrigin(.5);
    T(this, W / 2, 292, 'BREACH  DEFENSE', 24, '#9fb4c8', { letterSpacing: 8 }).setOrigin(.5);
    const z = [['walker', 90, 420], ['runner', 190, 470], ['brute', 400, 430], ['shield', 300, 520], ['spitter', 450, 540]];
    z.forEach(([k, x, y]) => { const e = this.add.image(x, y, ET[k].tex).setScale(S); this.tweens.add({ targets: e, y: y + 14, duration: rnd(700, 1100), yoyo: true, repeat: -1 }); });
    const best = +(localStorage.getItem('zd_best') || 0);
    T(this, W / 2, 610, best ? `最高纪录：第 ${best} 波` : `守住防线，撑过 ${MAXW} 波`, 24, '#c8d4e0').setOrigin(.5);
    const btn = this.add.rectangle(W / 2, 700, 340, 92, 0xe0642a).setStrokeStyle(4, 0xffd45a).setInteractive({ useHandCursor: true });
    T(this, W / 2, 700, '开始防守', 40, '#fff').setOrigin(.5);
    btn.on('pointerdown', () => { SFX.init(); SFX.play('select'); this.scene.start('Game'); });
    const mb = this.add.rectangle(490, 40, 56, 48, 0x10151c, .85).setStrokeStyle(2, 0x5a6a80).setDepth(30).setInteractive();
    const mt = T(this, 490, 40, SFX.muted ? '🔇' : '🔊', 26, '#fff').setOrigin(.5).setDepth(31);
    mb.on('pointerdown', () => mt.setText(SFX.toggle() ? '🔇' : '🔊'));
    this.tweens.add({ targets: btn, scaleX: 1.05, scaleY: 1.05, duration: 700, yoyo: true, repeat: -1 });
    T(this, W / 2, 790, '英雄自动射击 · 开局与升级时 3 选 1\n技能满级 + 对应被动即可进化 · 精英与首领掉落宝箱', 19, '#9fb4c8', { align: 'center', fontStyle: 'normal', lineSpacing: 8 }).setOrigin(.5).setDepth(30);
    if (BOT) this.time.delayedCall(300, () => this.scene.start('Game'));
  }
}

/* ============================== 战斗 ============================== */
class Game extends Phaser.Scene {
  constructor() { super('Game'); }

  create() {
    setupCam(this);
    this.speed = START_SPEED; this.state = 'play'; this.prevState = 'play';
    this.t = 0; this.wave = 0; this.waveT = 0; this.queue = [];
    this.enemies = []; this.bullets = []; this.zones = []; this.shells = []; this.bombs = [];
    this.bolts = []; this.beams = []; this.drones = []; this.pops = []; this.front = [];
    this.kills = 0; this.level = 1; this.xp = 0; this.xpNeed = this.needXp(1); this.pending = 0;
    this.skills = []; this.branchQ = []; this.refresh = 2; this.fxN = 0; this.sprPool = {};
    this.chestN = 0; this.endless = false; this.startPick = true;
    if (BOT) window.__waves = [];
    this.gun = { lv: 1, ammo: 30, reload: 0, cd: 0 };
    this.mod = {}; this.recalc(); this.wall = this.mod.wallMax; this.wallFlash = 0;
    this.aim = -Math.PI / 2; this.bossRef = null;

    this.add.image(W / 2, H / 2, 'bg').setScale(S).setDepth(0);
    this.add.image(W / 2, WALL_Y + (H - WALL_Y) / 2, 'fort').setScale(S).setDepth(20);
    this.hero = this.add.image(HX, HY, 'hero').setScale(S).setDepth(21);
    this.wg = this.add.graphics().setDepth(15);      // 世界血条
    this.fxg = this.add.graphics().setDepth(26);     // 光束 / 闪电
    this.hudg = this.add.graphics().setDepth(50);    // HUD 图形
    for (let i = 0; i < 36; i++) {
      const tx = T(this, 0, 0, '', 20, '#fff', { stroke: '#000', strokeThickness: 4 }).setOrigin(.5).setDepth(40).setVisible(false);
      this.pops.push({ o: tx, t: 0 });
    }
    this.buildHud();
    this.refreshSlots();
    this.tweens.timeScale = this.speed;
    this.game.events.on('hidden', this.onHidden, this);
    this.events.once('shutdown', () => this.game.events.off('hidden', this.onHidden, this));
    window.G = this;
    // 开局先 3 选 1 一个初始技能
    this.pending = 1; this.showPick();
  }
  onHidden() { if (!BOT && this.state === 'play') this.togglePause(); }

  /* ---------- 属性 ---------- */
  // 前 5 级极快（5/7/9/11/13），之后每级 +3
  needXp(l) { return l <= 5 ? 3 + 2 * l : 13 + 3 * (l - 5); }
  recalc() {
    const old = this.mod.wallMax || 0;
    const finals = this.skills ? this.skills.filter(s => s.br).length : 0;
    const droneGuard = this.skills && this.skills.some(s => s.id === 'drone' && s.br === 'a');
    this.mod = {
      dmg: 1 + .1 * finals, cd: Math.max(.55, 1 - .05 * finals), area: 1 + .08 * finals,
      pierce: 0, pen: 0, xp: 1 + .05 * finals,
      wallMax: 2100 + 250 * finals, regen: (droneGuard ? 5 : 0) + .5 * finals,
    };
    if (this.wall !== undefined && old) this.wall += Math.max(0, this.mod.wallMax - old);
  }
  skill(id) { return this.skills.find(s => s.id === id); }
  gunStats(l) {
    l = l || this.gun.lv;
    return {
      dmg: 8 * (1 + .25 * ((l >= 2) + (l >= 6))), mag: 30 + 6 * (l >= 3), shots: l >= 8 ? 3 : l >= 4 ? 2 : 1,
      rate: 5 * (l >= 5 ? 1.2 : 1), reload: 1.4 * (l >= 7 ? .7 : 1),
    };
  }

  /* ---------- 主循环 ---------- */
  update(time, delta) {
    const real = Math.min(delta, 50) / 1000;
    this.updatePops(real * this.speed);
    if (this.state === 'play') {
      const dt = real * this.speed;
      const n = Math.max(1, Math.ceil(dt / .025));
      for (let i = 0; i < n && this.state === 'play'; i++) this.step(dt / n);
      this.drawWorldFx(dt);
    }
    this.updateHud();
  }

  step(dt) {
    this.t += dt; this.waveT += dt;
    if (this.wave === 0) this.startWave();
    else if (this.waveT >= WAVE_LEN && (this.endless || this.wave < MAXW)) {
      // 场上积压过多时，推迟下一波（最多 BACKLOG_WAIT 秒）
      if (this.enemies.length <= BACKLOG_MAX || this.waveT >= WAVE_LEN + BACKLOG_WAIT) this.startWave();
    }
    while (this.queue.length && this.queue[0].t <= this.waveT) this.spawn(this.queue.shift());

    const al = this.enemies.filter(e => !e.dead);
    al.sort((a, b) => b.y - a.y);
    this.alive = al;
    this.front = al.filter(e => e.y > -10);

    this.updateEnemies(dt, al);
    this.updateGun(dt);
    for (const s of this.skills) this.updateSkill(s, dt);
    this.updateDrones(dt);
    this.updateBullets(dt);
    this.updateShells(dt);
    this.updateBombs(dt);
    this.updateZones(dt);
    this.enemies = this.enemies.filter(e => !e.dead);

    if (this.mod.regen > 0) this.wall = Math.min(this.mod.wallMax, this.wall + this.mod.regen * dt);
    if (this.wall <= 0) return this.endGame(false);
    if (!this.endless && this.wave === MAXW && this.waveT >= WAVE_LEN &&this.enemies.length === 0 && this.queue.length === 0) this.endGame(true);
  }

  /* ---------- 波次 ---------- */
  startWave() {
    if (BOT) window.__waves.push({ w: this.wave, t: Math.round(this.t), lv: this.level, wall: Math.round(this.wall), alive: this.enemies.length });
    // 撑过一波：城墙回复 5%
    if (this.wave > 0) this.wall = Math.min(this.mod.wallMax, this.wall + this.mod.wallMax * .05);
    this.wave++; this.waveT = 0;
    const w = this.wave, q = [];
    const bossWave = w % 10 === 0, eliteWave = w % 10 === 5;
    const types = [['walker', 5, 1, 1], ['runner', 3, 1.3, 2], ['swarm', 2, 3, 3], ['brute', 1.5, 6, 4], ['spitter', 1.5, 3, 5], ['shield', 1.6, 4.5, 7]];
    // 压力主要来自数量（单只怪血量增长较温和，见 spawn）
    let budget = (15 + w * TUNE.b1 + w * w * TUNE.b2) * (bossWave ? .6 : 1);
    const pool = types.filter(t => w >= t[3]);
    const tot = pool.reduce((a, t) => a + t[1], 0);
    let guard = 0;
    while (budget > 0 && guard++ < 400) {
      let r = Math.random() * tot, ch = pool[0];
      for (const t of pool) { r -= t[1]; if (r <= 0) { ch = t; break; } }
      budget -= ch[2];
      const t0 = rnd(0, WAVE_LEN * .78);
      if (ch[0] === 'swarm') {
        const cx = rnd(70, 470);
        for (let i = 0; i < 6; i++) q.push({ type: 'swarm', t: t0 + i * .12, x: clamp(cx + rnd(-50, 50), 20, 520) });
      } else q.push({ type: ch[0], t: t0, x: rnd(34, 506) });
    }
    if (bossWave) {
      const bs = w === 10 ? ['boss1'] : w === 20 ? ['boss2'] : ['boss1', 'boss2'];
      bs.forEach((b, i) => q.push({ type: b, t: .8 + i * 4, x: bs.length > 1 ? (i ? 360 : 180) : W / 2 }));
    }
    if (eliteWave) q.push({ type: 'elite', t: 2, x: rnd(120, 420) });
    q.sort((a, b) => a.t - b.t);
    this.queue = q;
    SFX.play(bossWave ? 'boss' : 'wave');
    const tag = this.endless ? `无尽 · 第 ${w} 波` : `第 ${w} 波`;
    this.banner(bossWave ? `${tag} · 首领来袭！` : eliteWave ? `${tag} · 精英出没` : tag, bossWave ? '#ff6a5a' : eliteWave ? '#ffb84a' : '#ffd45a');
  }

  spawn(q) {
    const d = ET[q.type], w = this.wave;
    const x = w - 1, hs = d.boss ? 1 + x * .015 : 1 + x * TUNE.hp1 + x * x * TUNE.hp2 + x * x * x * TUNE.hp3;
    const e = {
      type: q.type, d, x: q.x, y: q.y !== undefined ? q.y : -40 - rnd(0, 20), hp: d.hp * hs, maxhp: d.hp * hs,
      spd: d.spd * (d.boss ? 1 : rnd(.9, 1.12) * (1 + (w - 1) * .015)), r: d.r, armor: d.armor, dmg: d.dmg * (1 + (w - 1) * TUNE.dmgw),
      slowT: 0, slowMul: 1, freezeT: 0, stunT: 0, burnT: 0, burnDps: 0, burnAcc: 0, kbv: 0, markT: 0,
      flash: 0, acc: 0, accT: 0, accCol: '#fff', atkT: rnd(0, .8), ph: rnd(0, 6.28), dead: false,
      stopY: rnd(260, 420), sumT: 3, tint: 0,
    };
    e.spr = this.add.image(e.x, e.y, d.tex).setScale(S * (d.scale || 1)).setDepth(10);
    if (d.elite) e.spr.setTint(0xffd070);
    this.enemies.push(e);
    return e;
  }

  /* ---------- 敌人 ---------- */
  updateEnemies(dt, al) {
    const t = this.t;
    for (const e of al) {
      let sp = e.spd;
      if (e.freezeT > 0) { e.freezeT -= dt; sp = 0; }
      else if (e.stunT > 0) { e.stunT -= dt; sp = 0; }
      else if (e.slowT > 0) { e.slowT -= dt; sp *= e.slowMul; }
      if (e.markT > 0) e.markT -= dt;
      if (e.burnT > 0) {
        e.burnT -= dt; e.burnAcc += dt;
        if (e.burnAcc >= .5) { e.burnAcc -= .5; this.dealDamage(e, e.burnDps, { dot: 1, color: '#ff9a3c' }); if (e.dead) continue; }
      }
      if (e.kbv > 0) { e.y -= e.kbv * dt; e.kbv = Math.max(0, e.kbv - 700 * dt); }
      const limit = WALL_Y - e.r * .5;
      if (e.d.ranged) {
        if (e.y < e.stopY) e.y += sp * dt;
        else if (e.stunT <= 0 && e.freezeT <= 0) { e.atkT += dt; if (e.atkT >= 2.2) { e.atkT = 0; this.spitAt(e); } }
      } else if (e.y < limit - 14) {
        e.y += sp * dt;
        e.x += Math.sin(t * 2 + e.ph) * 6 * dt;
      } else if (e.stunT <= 0 && e.freezeT <= 0) {
        e.atkT += dt;
        const iv = e.d.boss ? 1.8 : 1;
        if (e.atkT >= iv) { e.atkT = 0; this.hitWall(e.dmg); }
      }
      if (e.d.boss && e.freezeT <= 0 && e.stunT <= 0) {
        e.sumT -= dt;
        if (e.sumT <= 0) {
          e.sumT = e.type === 'boss1' ? 6.5 : 5.5;
          const n = e.type === 'boss1' ? 2 : 3;
          for (let i = 0; i < n; i++) { const c = this.spawn({ type: e.type === 'boss1' ? 'walker' : pick(['runner', 'walker', 'brute']), x: clamp(e.x + rnd(-60, 60), 20, 520), y: e.y + 30 }); c.spr.setAlpha(.9); }
        }
      }
    }
    // 分离，避免重叠
    for (let i = 0; i < al.length; i++) {
      const a = al[i]; if (a.dead) continue;
      for (let j = i + 1; j < al.length; j++) {
        const b = al[j]; if (b.dead) continue;
        const dy = b.y - a.y; if (dy < -80 || dy > 80) continue;
        const dx = b.x - a.x, md = (a.r + b.r) * .72;
        if (dx > md || dx < -md) continue;
        const d2 = dx * dx + dy * dy; if (d2 >= md * md) continue;
        const d = Math.sqrt(d2) || .01, push = (md - d) * .35;
        const ma = a.r * a.r, mb = b.r * b.r, ta = mb / (ma + mb), tb = ma / (ma + mb);
        const nx = d < .02 ? rnd(-1, 1) : dx / d, ny = d < .02 ? 0 : dy / d;
        a.x -= nx * push * ta; a.y -= ny * push * ta * .6;
        b.x += nx * push * tb; b.y += ny * push * tb * .6;
      }
    }
    this.wg.clear();
    for (const e of al) {
      if (e.dead) continue;
      e.x = clamp(e.x, e.r * .5, W - e.r * .5);
      if (!e.d.ranged) e.y = Math.min(e.y, WALL_Y - e.r * .5);
      e.spr.setPosition(e.x, e.y).setRotation(Math.sin(t * 6 + e.ph) * .12).setDepth(10 + e.y / 1000);
      let tint = 0;
      if (e.flash > 0) { e.flash -= dt; tint = 2; } else if (e.freezeT > 0) tint = 3; else if (e.slowT > 0) tint = 1; else if (e.burnT > 0) tint = 4;
      if (tint !== e.tint) {
        e.tint = tint;
        if (tint === 0) { if (e.d.elite) e.spr.setTint(0xffd070); else e.spr.clearTint(); }
        else if (tint === 2) e.spr.setTint(0xffb8a0);
        else e.spr.setTint(tint === 1 ? 0x9fd8ff : tint === 3 ? 0x66ccff : 0xffb27a);
      }
      if (e.acc > 0) { e.accT -= dt; if (e.accT <= 0) this.flushAcc(e); }
      if (e.d.bar && e.hp < e.maxhp) {
        const bw = e.r * 1.6, bx = e.x - bw / 2, by = e.y - e.r - 8;
        this.wg.fillStyle(0x000000, .6).fillRect(bx - 1, by - 1, bw + 2, 6);
        this.wg.fillStyle(0xff5a4a).fillRect(bx, by, bw * clamp(e.hp / e.maxhp, 0, 1), 4);
      }
    }
  }
  flushAcc(e) {
    if (e.acc >= 1) this.pop(e.x + rnd(-8, 8), e.y - e.r, Math.round(e.acc), e.accCol, e.acc > 60 ? 28 : 20);
    e.acc = 0; e.accT = .3;
  }
  hitWall(d) {
    this.wall -= d; this.wallFlash = .15; SFX.play('wall');
    this.cameras.main.shake(60, .0016 * Math.min(4, d / 8));
  }
  spitAt(e) {
    SFX.play('spit');
    const spr = this.add.image(e.x, e.y + 10, 'spit').setScale(S).setDepth(22);
    this.tweens.add({
      targets: spr, x: e.x + rnd(-60, 60), y: WALL_Y, duration: 600, onComplete: () => {
        spr.destroy(); if (this.state === 'end') return; this.hitWall(e.dmg); this.fxBurst(spr.x, WALL_Y, 0x9be04a, 5, 90);
      },
    });
  }

  dealDamage(e, dmg, o = {}) {
    if (e.dead) return false;
    let d = dmg * this.mod.dmg;
    // 护甲按百分比减伤（护甲 7 ≈ -41%），避免低伤害武器完全打不动
    if (!o.dot && !o.ignoreArmor) { const arm = Math.max(0, e.armor - (o.pen || 0)); d *= 10 / (10 + arm); }
    if (e.markT > 0) d *= 1.2;
    e.hp -= d; e.acc += d; e.accCol = o.color || '#fff'; e.flash = .06;
    const boss = e.d.boss;
    if (o.slow) { e.slowMul = Math.min(e.slowMul, 1 - o.slow * (boss ? .5 : 1)); e.slowT = Math.max(e.slowT, o.slowT || 2); }
    if (o.fz && !boss && Math.random() < o.fz[0]) e.freezeT = Math.max(e.freezeT, o.fz[1]);
    if (o.stun) { const st = o.stun * (boss ? .25 : 1); e.stunT = Math.max(e.stunT, st); }
    if (o.knock) e.kbv = Math.max(e.kbv, o.knock * (boss ? .1 : e.d.big ? .45 : 1));
    if (o.burn) { e.burnT = Math.max(e.burnT, o.burn.dur); e.burnDps = Math.max(e.burnDps, o.burn.dps); }
    if (o.mark) e.markT = Math.max(e.markT, o.mark);
    if (e.hp <= 0) { this.kill(e); return true; }
    return false;
  }
  kill(e) {
    e.dead = true; this.kills++;
    SFX.play(e.d.boss ? 'boss' : 'kill');
    this.flushAcc(e);
    this.fxBurst(e.x, e.y, e.d.boss ? 0xff8a4a : 0xb6ffb0, e.d.boss ? 22 : e.d.big ? 8 : 4, e.d.big ? 160 : 110);
    if (e.d.boss) { this.fxRing(e.x, e.y, 220, 0xff8a4a); this.cameras.main.shake(300, .01); }
    e.spr.destroy();
    if (e.d.boss || e.d.elite) this.dropChest(e.x, e.y, e.d.boss ? 3 : 1);
    // 怪物经验随波次增长，保证升级速度跟得上
    this.addXp(e.d.xp * this.mod.xp * (1 + TUNE.xpw * (this.wave - 1)));
  }
  dropChest(x, y, n) {
    const spr = this.add.image(x, y, 'chest').setScale(S * 1.3).setDepth(45);
    const gl = this.add.image(x, y, 'glow').setDisplaySize(140, 140).setTint(0xffd45a).setAlpha(.7).setBlendMode(Phaser.BlendModes.ADD).setDepth(44);
    this.tweens.add({ targets: [spr, gl], y: y - 40, duration: 350, ease: 'Quad.easeOut', yoyo: true });
    this.tweens.add({
      targets: [spr, gl], x: HX, y: HY - 70, delay: 900, duration: 600, ease: 'Cubic.easeIn', onComplete: () => {
        spr.destroy(); gl.destroy();
        if (this.state === 'end') return;
        this.chestN += n; this.pending += n;
        this.fxRing(HX, HY - 70, 120, 0xffd45a);
        if (this.state === 'play') this.showPick();
      },
    });
  }
  addXp(v) {
    this.xp += v;
    while (this.xp >= this.xpNeed) {
      this.xp -= this.xpNeed; this.level++; this.xpNeed = this.needXp(this.level); this.pending++;
    }
    if (this.pending > 0 && this.state === 'play') this.showPick();
  }

  /* ---------- 子弹 ---------- */
  getSpr(key) {
    const p = this.sprPool[key] || (this.sprPool[key] = []);
    const s = p.pop() || this.add.image(0, 0, key).setScale(S);
    return s.setActive(true).setVisible(true);
  }
  freeSpr(s, key) { s.setActive(false).setVisible(false); (this.sprPool[key] || (this.sprPool[key] = [])).push(s); }
  fireBullet(key, x, y, ang, speed, dmg, o = {}) {
    const spr = this.getSpr(key).setPosition(x, y).setRotation(ang + Math.PI / 2).setDepth(23).clearTint();
    if (o.tint) spr.setTint(o.tint);
    this.bullets.push({ key, spr, x, y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, dmg, pierce: o.pierce || 0, rad: o.rad || 5, o, hit: [] });
  }
  updateBullets(dt) {
    const bl = this.bullets;
    for (let i = bl.length - 1; i >= 0; i--) {
      const b = bl[i];
      b.x += b.vx * dt; b.y += b.vy * dt;
      let done = b.x < -30 || b.x > W + 30 || b.y < -40 || b.y > H;
      if (!done) {
        for (const e of this.front) {
          if (e.dead || b.hit.includes(e)) continue;
          const dx = e.x - b.x, dy = e.y - b.y, r = e.r + b.rad;
          if (dx * dx + dy * dy > r * r) continue;
          b.hit.push(e);
          const bd = b.dmg * (b.o.vsSlow && (e.slowT > 0 || e.freezeT > 0) ? 1.5 : 1);
          this.dealDamage(e, bd, b.o);
          if (b.o.split && !b.splitDone) {
            b.splitDone = true;
            const sa = Math.atan2(b.vy, b.vx);
            for (let k = -1; k <= 1; k++) this.fireBullet('b_ice', b.x, b.y, sa + k * .9, 430, b.dmg * .55, { pierce: 0, rad: 8, fx: 0x9fe4ff });
          }
          this.fxBurst(b.x, b.y, b.o.fx || 0xffe27a, 2, 70);
          SFX.play('hit');
          if (b.pierce <= 0) { done = true; break; }
          b.pierce--;
        }
      }
      if (done) { this.freeSpr(b.spr, b.key); bl.splice(i, 1); } else b.spr.setPosition(b.x, b.y);
    }
  }

  /* ---------- 主武器 ---------- */
  updateGun(dt) {
    const g = this.gun, gs = this.gunStats(), tg = this.front[0];
    if (tg) {
      const a = Math.atan2(tg.y - HY, tg.x - HX);
      let da = a - this.aim; while (da > Math.PI) da -= 6.283; while (da < -Math.PI) da += 6.283;
      this.aim += da * Math.min(1, dt * 18);
      this.hero.setRotation(this.aim + Math.PI / 2);
    }
    if (g.reload > 0) { g.reload -= dt; if (g.reload <= 0) g.ammo = gs.mag; return; }
    g.cd -= dt;
    if (g.cd <= 0 && tg) {
      const a = Math.atan2(tg.y - (HY - 30), tg.x - HX);
      for (let i = 0; i < gs.shots; i++) {
        const aa = a + (i - (gs.shots - 1) / 2) * .09 + rnd(-.015, .015);
        this.fireBullet('b_main', HX + Math.cos(a) * 34, HY - 18 + Math.sin(a) * 34, aa, 980, gs.dmg, { pierce: this.mod.pierce, pen: this.mod.pen, rad: 4 });
      }
      SFX.play('shoot');
      g.ammo--; g.cd = 1 / (gs.rate / this.mod.cd);
      if (g.ammo <= 0) g.reload = gs.reload * this.mod.cd + .2;
    }
  }

  /* ---------- 技能 ---------- */
  updateSkill(s, dt) {
    if (s.id === 'drone') return;
    s.t -= dt;
    if (s.t > 0) { return; }
    if (this.front.length === 0) { s.t = 0; return; }
    const cd = this['cast_' + s.id](s) * (s.br ? .75 : 1);
    s.cdTotal = cd * this.mod.cd; s.t = s.cdTotal;
  }
  cast_frost(s) {
    SFX.play('ice');
    const l = s.lv, tg = this.front[0], st = SKILL_STATS.frost(l);
    const A = s.br === 'a', B = s.br === 'b';
    const n = st.冰晶 + (A ? 1 : 0), pierce = st.穿透 + this.mod.pierce + (B ? 1 : 0);
    const dmg = st.伤害 * (A ? 1.75 : B ? 1.85 : 1), slow = l >= 3 ? .5 : .35;
    const fz = [A ? .4 : l >= 5 ? .25 : 0, 1.2];
    const o = { pierce, slow, slowT: 2.2, fz: fz[0] ? fz : null, pen: this.mod.pen, rad: 8, fx: 0x9fe4ff, vsSlow: B, split: B };
    const base = Math.atan2(tg.y - HY, tg.x - HX);
    for (let i = 0; i < n; i++) this.fireBullet('b_ice', HX, HY - 30, base + (i - (n - 1) / 2) * .17, 560, dmg, o);
    if (A) for (let i = 0; i < 11; i++) {
      const a = -Math.PI + (i + .5) * Math.PI / 11;
      this.fireBullet('b_ice', HX, HY - 30, a, 430, dmg * .7, Object.assign({}, o, { pierce: pierce + 1 }));
    }
    return 1.7;
  }
  cast_rail(s) {
    SFX.play('rail');
    const l = s.lv, st = SKILL_STATS.rail(l), A = s.br === 'a', B = s.br === 'b';
    const n = A ? 3 : B ? 1 : st.光束;
    const dmg = st.伤害 * (A ? 1.8 : B ? 1.8 : 1), w = st.宽度 + (A ? 10 : B ? 48 : 0);
    const ign = l >= 3 || A || B;
    const tg = this.front.slice().sort((a, b) => b.hp - a.hp).slice(0, n);
    const ox = HX, oy = HY - 30;
    for (const t of tg) {
      const a = Math.atan2(t.y - oy, t.x - ox), dx = Math.cos(a), dy = Math.sin(a);
      this.beams.push({ x1: ox, y1: oy, x2: ox + dx * 1400, y2: oy + dy * 1400, t: .22, T: .22, w, c: A ? 0xff7aff : B ? 0x8f7aff : 0x9a8aff });
      for (const e of this.front) {
        if (e.dead) continue;
        const px = e.x - ox, py = e.y - oy, al = px * dx + py * dy;
        if (al < 0) continue;
        const dist = Math.abs(px * dy - py * dx);
        if (dist < e.r + w / 2) this.dealDamage(e, dmg, { ignoreArmor: ign, pen: this.mod.pen, color: '#c9b8ff', stun: A ? .6 : B ? .2 : 0 });
      }
      this.fxBurst(t.x, t.y, 0xc9b8ff, 5, 120);
      if (B) this.addZone(t.x, t.y, 70, 2.5, dmg * .35, { tint: 0x8f7aff, color: '#b8a8ff' });
    }
    this.cameras.main.shake(80, .003);
    return st.冷却;
  }
  pickClusters(n, rad, from) {
    const cand = from.slice(0, 40), res = [];
    for (let k = 0; k < n; k++) {
      let best = null, bs = -1;
      for (const e of cand) {
        if (res.some(r => Math.hypot(r.x - e.x, r.y - e.y) < rad * .9)) continue;
        let c = 0; for (const o of cand) if (Math.hypot(o.x - e.x, o.y - e.y) < rad) c += o.d.big ? 3 : 1;
        c += e.y / 400;
        if (c > bs) { bs = c; best = e; }
      }
      if (!best) { const e = pick(from); res.push({ x: clamp(e.x + rnd(-30, 30), 20, 520), y: clamp(e.y + rnd(-30, 30), 40, 770) }); }
      else res.push({ x: best.x, y: best.y });
    }
    return res;
  }
  cast_fire(s) {
    SFX.play('toss');
    const l = s.lv, st = SKILL_STATS.fire(l), A = s.br === 'a', B = s.br === 'b';
    const n = A ? 3 : st.数量, tgs = this.pickClusters(n, 90, this.front);
    const rad = st.范围 * (A ? 1.55 : 1), dmg = st.伤害 * (A ? 1.75 : 1);
    const fdps = st.灼烧, fdur = A ? 6 : st.持续;
    tgs.forEach((p, i) => this.launchShell(HX + (i - (n - 1) / 2) * 20, HY - 30, p.x, p.y, .6 + i * .08, 'shell', 1.2, () => {
      this.explode(p.x, p.y, rad, dmg, { color: '#ffa040', fx: 0xff8a3a, knock: 220, pen: 0 });
      if (B) {
        for (let k = -2; k <= 2; k++) this.addZone(p.x, clamp(p.y + k * 52, 40, 880), 48, 5, fdps * 1.2, { slow: .4 });
      } else {
        this.addZone(p.x, p.y, rad * .85, fdur, fdps, { slow: (l >= 5 || A) ? .3 : 0, burn: A ? { dps: fdps * .6, dur: 3 } : null });
      }
    }));
    return 3.4;
  }
  cast_chain(s) {
    SFX.play('zap');
    const l = s.lv, st = SKILL_STATS.chain(l), A = s.br === 'a', B = s.br === 'b';
    const dmg = st.伤害 * (A ? 1.7 : B ? 1.7 : 1);
    if (B) {
      const alive = this.front.filter(e => !e.dead);
      if (!alive.length) return st.冷却;
      let cur = alive.slice().sort((a, b) => b.hp - a.hp)[0];
      let px = HX, py = HY - 30, d = dmg * .85;
      for (let j = 0; j < 10; j++) {
        this.bolts.push({ pts: this.jag(px, py, cur.x, cur.y), t: .18, T: .18 });
        this.dealDamage(cur, d, { pen: 5, color: '#fff27a', stun: .15 });
        for (const e of this.front) if (!e.dead && e !== cur && Math.hypot(e.x - cur.x, e.y - cur.y) < 60) this.dealDamage(e, d * .4, { pen: 5, color: '#fff27a' });
        this.fxBurst(cur.x, cur.y, 0xfff27a, 2, 80);
        px = cur.x; py = cur.y; d *= 1.09;
      }
      this.explode(cur.x, cur.y, 130, dmg * 2, { color: '#fff27a', fx: 0xffe45a, stun: .6, knock: 180 });
      return st.冷却 * .85;
    }
    const nCh = A ? 3 : 1, jumps = st.跳跃 + (A ? 4 : 0);
    const fall = l >= 5 ? 1 : .88;
    const starts = this.front.slice(0, 6);
    for (let c = 0; c < nCh && c < starts.length; c++) {
      let cur = starts[c], d = dmg, px = HX, py = HY - 30; const hit = [cur];
      for (let j = 0; j < jumps; j++) {
        this.bolts.push({ pts: this.jag(px, py, cur.x, cur.y), t: .2, T: .2 });
        this.dealDamage(cur, d, { pen: 5, color: '#fff27a', stun: l >= 3 && Math.random() < .35 ? .45 : 0 });
        this.fxBurst(cur.x, cur.y, 0xfff27a, 2, 80);
        const near = this.alive.filter(e => !e.dead && !hit.includes(e) && e.y > -10 && Math.hypot(e.x - cur.x, e.y - cur.y) < 170)
          .sort((a, b) => Math.hypot(a.x - cur.x, a.y - cur.y) - Math.hypot(b.x - cur.x, b.y - cur.y));
        if (!near.length) break;
        if (A && near[1]) { const f = near[1]; hit.push(f); this.bolts.push({ pts: this.jag(cur.x, cur.y, f.x, f.y), t: .2, T: .2 }); this.dealDamage(f, d * .7, { pen: 5, color: '#fff27a' }); }
        px = cur.x; py = cur.y; cur = near[0]; hit.push(cur); d *= fall;
      }
    }
    return st.冷却;
  }
  jag(x1, y1, x2, y2) {
    const pts = [{ x: x1, y: y1 }], n = 6, dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
    for (let i = 1; i < n; i++) pts.push({ x: x1 + dx * i / n + (-dy / len) * rnd(-14, 14), y: y1 + dy * i / n + (dx / len) * rnd(-14, 14) });
    pts.push({ x: x2, y: y2 }); return pts;
  }
  cast_air(s) {
    SFX.play('whistle');
    const l = s.lv, st = SKILL_STATS.air(l), rad = st.范围, dmg = st.伤害;
    const A = s.br === 'a', B = s.br === 'b';
    if (A) {
      const c = this.pickClusters(1, 120, this.front)[0];
      for (let i = 0; i < 10; i++) this.bombs.push({ x: clamp(c.x + rnd(-24, 24), 30, 510), y: 760 - i * 66, t: .6 + i * .12, r: 74, dmg: dmg * 1.4, stun: .4 });
    } else if (B) {
      const c = this.pickClusters(1, 120, this.front)[0];
      this.bombs.push({ x: c.x, y: c.y, t: .9, r: 170, dmg: dmg * 5, stun: 1, zone: { r: 120, dur: 5, dps: dmg * .45 } });
    } else {
      const n = st.炸弹;
      this.pickClusters(n, 100, this.front).forEach((p, i) => this.bombs.push({ x: p.x + rnd(-14, 14), y: p.y + rnd(-14, 14), t: .9 + i * .12, r: rad, dmg, stun: l >= 4 ? .5 : 0 }));
    }
    return st.冷却;
  }
  updateBombs(dt) {
    for (let i = this.bombs.length - 1; i >= 0; i--) {
      const b = this.bombs[i]; b.t -= dt;
      if (!b.mk) { b.mk = this.add.image(b.x, b.y, 'ring').setDisplaySize(b.r * 2 * this.mod.area, b.r * 2 * this.mod.area).setTint(0xff5a3a).setAlpha(.7).setDepth(5); }
      if (b.t <= 0) {
        b.mk.destroy();
        this.explode(b.x, b.y, b.r, b.dmg, { color: '#ff7a5a', fx: 0xff6a4a, stun: b.stun, knock: 260 });
        if (b.zone) this.addZone(b.x, b.y, b.zone.r, b.zone.dur, b.zone.dps, { tint: 0xb8452e, color: '#ff7a5a' });
        this.cameras.main.shake(100, .004);
        this.bombs.splice(i, 1);
      }
    }
  }
  launchShell(x, y, tx, ty, T, key, sc, land) {
    const spr = this.add.image(x, y, key).setScale(S).setDepth(24);
    this.shells.push({ x, y, sx: x, sy: y, tx, ty, t: 0, T, spr, sc, land });
  }
  updateShells(dt) {
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i]; s.t += dt;
      const k = Math.min(1, s.t / s.T);
      s.x = s.sx + (s.tx - s.sx) * k; s.y = s.sy + (s.ty - s.sy) * k;
      const arc = Math.sin(k * Math.PI);
      s.spr.setPosition(s.x, s.y - arc * 60).setScale(S * s.sc * (1 + arc * .6));
      if (k >= 1) { s.spr.destroy(); this.shells.splice(i, 1); s.land(); }
    }
  }
  explode(x, y, r, dmg, o = {}) {
    r *= this.mod.area; SFX.play('boom');
    this.fxRing(x, y, r, o.fx || 0xffa040);
    for (const e of this.alive || []) {
      if (e.dead) continue;
      const d = Math.hypot(e.x - x, e.y - y);
      if (d < r + e.r * .5) this.dealDamage(e, dmg * (1 - .3 * Math.min(1, d / r)), { color: o.color, stun: o.stun, knock: o.knock, pen: o.pen });
    }
    this.fxBurst(x, y, o.fx || 0xffa040, 8, 150);
  }
  addZone(x, y, r, dur, dps, o = {}) {
    const spr = this.add.image(x, y, 'glow').setDisplaySize(r * 2.4 * this.mod.area, r * 2.4 * this.mod.area).setTint(o.tint || 0xff6a20).setAlpha(.55).setBlendMode(Phaser.BlendModes.ADD).setDepth(4);
    this.zones.push({ x, y, r: r * this.mod.area, t: dur, T: dur, tick: .25, dps, o, spr });
  }
  updateZones(dt) {
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const z = this.zones[i]; z.t -= dt; z.tick -= dt;
      z.spr.setAlpha(.25 + .35 * Math.min(1, z.t / 1.2) * (.8 + .2 * Math.sin(this.t * 14 + i)));
      if (z.tick <= 0) {
        z.tick = .5;
        for (const e of this.alive) {
          if (e.dead || Math.hypot(e.x - z.x, e.y - z.y) > z.r + e.r * .4) continue;
          if (z.o.slow) { e.slowMul = Math.min(e.slowMul, 1 - z.o.slow * (e.d.boss ? .5 : 1)); e.slowT = Math.max(e.slowT, .8); }
          this.dealDamage(e, z.dps, { dot: 1, color: z.o.color || '#ff9a3c', burn: z.o.burn });
        }
      }
      if (z.t <= 0) { z.spr.destroy(); this.zones.splice(i, 1); }
    }
  }

  /* ---------- 无人机 ---------- */
  syncDrones() {
    const s = this.skill('drone');
    const n = !s ? 0 : s.br === 'a' ? 4 : SKILL_STATS.drone(s.lv).台数;
    while (this.drones.length < n) this.drones.push({ spr: this.add.image(HX, HY, 'drone').setScale(S).setDepth(22), t: rnd(0, .5), mt: rnd(0, 2) });
    while (this.drones.length > n) this.drones.pop().spr.destroy();
  }
  updateDrones(dt) {
    const s = this.skill('drone'); if (!s) return;
    const A = s.br === 'a', B = s.br === 'b';
    const n = this.drones.length, tgAll = this.front.filter(e => !e.dead);
    const tg = B ? (tgAll.length ? tgAll.reduce((a, b) => a.hp < b.hp ? a : b) : null) : this.front[0];
    const st = SKILL_STATS.drone(s.lv), rate = (A ? .38 : B ? st.射击间隔 * .65 : st.射击间隔) / (A ? 1.4 : 1);
    const dmgMul = A ? 1.35 : B ? 1.25 : 1;
    this.drones.forEach((d, i) => {
      const tx = HX + (i - (n - 1) / 2) * 96, ty = HY - 62 + Math.sin(this.t * 3 + i * 1.7) * 6;
      d.spr.x += (tx - d.spr.x) * Math.min(1, dt * 6); d.spr.y += (ty - d.spr.y) * Math.min(1, dt * 6);
      d.spr.rotation += dt * 4;
      if (!tg) return;
      d.t -= dt;
      if (d.t <= 0) {
        d.t = rate * this.mod.cd; SFX.play('drone');
        const a = Math.atan2(tg.y - d.spr.y, tg.x - d.spr.x);
        this.fireBullet('b_drone', d.spr.x, d.spr.y, a, 780, st.伤害 * dmgMul, { rad: 4, fx: 0x66ffd8, pen: this.mod.pen, mark: B ? 3 : 0 });
      }
      if (s.lv >= 4) {
        d.mt -= dt;
        if (d.mt <= 0) {
          d.mt = (A ? 2.2 : 4) * this.mod.cd;
          const c = this.pickClusters(1, 70, this.front)[0];
          this.launchShell(d.spr.x, d.spr.y, c.x, c.y, .35, 'b_drone', 1.6, () => this.explode(c.x, c.y, 56, (24 + 6 * (s.lv - 4) + (A ? 14 : 0)) * dmgMul, { color: '#9ff5dc', fx: 0x66ffd8, knock: 120 }));
        }
      }
    });
  }

  /* ---------- 特效 ---------- */
  fxBurst(x, y, color, n, sp) {
    if (this.fxN > 90) return;
    for (let i = 0; i < n; i++) {
      this.fxN++;
      const a = rnd(0, 6.28), d = rnd(.4, 1) * sp * .4;
      const o = this.add.image(x, y, 'dot').setTint(color).setDepth(30).setScale(rnd(.5, 1) * S * 1.2);
      this.tweens.add({ targets: o, x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, alpha: 0, duration: rnd(220, 420), onComplete: () => { o.destroy(); this.fxN--; } });
    }
  }
  fxRing(x, y, r, color) {
    const o = this.add.image(x, y, 'ring').setTint(color).setDepth(30).setDisplaySize(r * .6, r * .6).setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({ targets: o, displayWidth: r * 2, displayHeight: r * 2, alpha: 0, duration: 300, ease: 'Cubic.easeOut', onComplete: () => o.destroy() });
    const g = this.add.image(x, y, 'glow').setTint(color).setDepth(29).setDisplaySize(r * 2, r * 2).setAlpha(.8).setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({ targets: g, alpha: 0, duration: 260, onComplete: () => g.destroy() });
  }
  drawWorldFx(dt) {
    const g = this.fxg; g.clear();
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i]; b.t -= dt; if (b.t <= 0) { this.beams.splice(i, 1); continue; }
      const k = b.t / b.T;
      g.lineStyle(b.w * k * 1.6, b.c, .35 * k).lineBetween(b.x1, b.y1, b.x2, b.y2);
      g.lineStyle(b.w * k * .8, 0xffffff, .9 * k).lineBetween(b.x1, b.y1, b.x2, b.y2);
    }
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i]; b.t -= dt; if (b.t <= 0) { this.bolts.splice(i, 1); continue; }
      const k = b.t / b.T;
      for (const [w, c, a] of [[7, 0xffe94d, .4 * k], [2.5, 0xffffff, k]]) {
        g.lineStyle(w, c, a); g.beginPath(); g.moveTo(b.pts[0].x, b.pts[0].y);
        for (let j = 1; j < b.pts.length; j++) g.lineTo(b.pts[j].x, b.pts[j].y);
        g.strokePath();
      }
    }
  }
  pop(x, y, n, color, size) {
    const p = this.pops.find(p => p.t <= 0); if (!p) return;
    p.t = .7; p.x = x; p.y = y;
    p.o.setText(String(n)).setColor(color).setFontSize(size).setPosition(x, y).setVisible(true).setAlpha(1);
  }
  updatePops(dt) {
    for (const p of this.pops) if (p.t > 0) {
      p.t -= dt; p.y -= 46 * dt; p.o.setY(p.y).setAlpha(Math.min(1, p.t * 3));
      if (p.t <= 0) p.o.setVisible(false);
    }
  }
  banner(txt, color) {
    const t = T(this, W / 2, 190, txt, 44, color, { stroke: '#000', strokeThickness: 8 }).setOrigin(.5).setDepth(60).setAlpha(0);
    this.tweens.add({ targets: t, alpha: 1, y: 200, duration: 250, yoyo: true, hold: 900, onComplete: () => t.destroy() });
  }

  /* ---------- HUD ---------- */
  buildHud() {
    this.hud = {};
    const D = 52;
    const pb = this.add.circle(36, 36, 22, 0x10151c, .85).setStrokeStyle(2, 0x5a6a80).setDepth(D).setInteractive();
    T(this, 36, 36, '❚❚', 16, '#dfe8f2').setOrigin(.5).setDepth(D + 1);
    pb.on('pointerdown', () => this.togglePause());
    const mb = this.add.rectangle(436, 36, 44, 40, 0x10151c, .85).setStrokeStyle(2, 0x5a6a80).setDepth(D).setInteractive();
    const mt = T(this, 436, 36, SFX.muted ? '🔇' : '🔊', 22, '#fff').setOrigin(.5).setDepth(D + 1);
    mb.on('pointerdown', () => mt.setText(SFX.toggle() ? '🔇' : '🔊'));
    this.hud.time = T(this, 76, 36, '00:00', 22, '#dfe8f2', { stroke: '#000', strokeThickness: 4 }).setOrigin(0, .5).setDepth(D);
    this.hud.wave = T(this, W / 2 + 10, 34, '', 26, '#ffd45a', { stroke: '#000', strokeThickness: 5 }).setOrigin(.5).setDepth(D);
    const sb = this.add.rectangle(498, 36, 64, 40, 0x10151c, .85).setStrokeStyle(2, 0x5a6a80).setDepth(D).setInteractive();
    this.hud.spd = T(this, 498, 36, '×1', 22, '#dfe8f2').setOrigin(.5).setDepth(D + 1);
    sb.on('pointerdown', () => { this.speed = this.speed >= 2 ? 1 : this.speed >= 1.5 ? 2 : 1.5; this.tweens.timeScale = this.speed; });
    this.hud.lv = T(this, 8, 80, 'Lv.1', 18, '#7fd8ff', { stroke: '#000', strokeThickness: 4 }).setDepth(D);
    this.hud.kills = T(this, W - 8, 80, '', 18, '#c8d4e0', { stroke: '#000', strokeThickness: 4 }).setOrigin(1, 0).setDepth(D);
    this.hud.wallT = T(this, W / 2, 940, '', 20, '#fff', { stroke: '#000', strokeThickness: 4 }).setOrigin(.5).setDepth(D + 1);
    this.hud.boss = T(this, W / 2, 104, '', 20, '#ff8a7a', { stroke: '#000', strokeThickness: 4 }).setOrigin(.5).setDepth(D + 1).setVisible(false);
    this.hud.slots = [];
    this.hud.ammo = T(this, 502, 162, '', 14, '#ffe27a', { stroke: '#000', strokeThickness: 3 }).setOrigin(.5).setDepth(D + 2);
  }
  refreshSlots() {
    for (const o of this.hud.slots) o.destroy();
    this.hud.slots = []; this.slotPos = [];
    const D = 52, add = o => { this.hud.slots.push(o); return o; };
    const icon = (x, y, r, color, glyph, lv, max, br) => {
      add(this.add.circle(x, y, r, 0x10151c, .85).setStrokeStyle(br ? 4 : 2, br ? 0xffd45a : color).setDepth(D));
      add(this.add.circle(x, y, r - 4, color, .35).setDepth(D));
      add(T(this, x, y - 1, glyph, r * .95, '#fff').setOrigin(.5).setDepth(D + 1));
      if (br) {
        add(this.add.circle(x - r * .82, y + r * .68, 12, br === 'a' ? 0x2f8fd6 : 0xb8452e, .95).setStrokeStyle(2, 0xffd45a).setDepth(D + 2));
        add(T(this, x - r * .82, y + r * .68, br.toUpperCase(), 13, '#fff').setOrigin(.5).setDepth(D + 3));
      }
      if (lv) add(T(this, x + r * .75, y + r * .75, lv >= max ? 'MAX' : String(lv), lv >= max ? 12 : 15, lv >= max ? '#ffd45a' : '#fff', { stroke: '#000', strokeThickness: 4 }).setOrigin(.5).setDepth(D + 2));
    };
    icon(502, 128, 27, 0x6b7686, '枪', this.gun.lv, MAX_GUN);
    for (let i = 0; i < SLOTS; i++) {
      const x = 502, y = 214 + i * 66, s = this.skills[i];
      this.slotPos.push({ x, y, r: 27 });
      if (s) icon(x, y, 27, SKILLS[s.id].color, SKILLS[s.id].glyph, s.lv, MAX_SKILL, s.br);
      else add(this.add.circle(x, y, 27, 0x10151c, .5).setStrokeStyle(2, 0x3a4658).setDepth(D));
    }
  }
  updateHud() {
    const g = this.hudg; g.clear();
    this.hud.time.setText(fmtTime(this.t));
    this.hud.wave.setText(this.endless ? `无尽 第 ${this.wave} 波` : `第 ${Math.max(1, this.wave)}/${MAXW} 波`);
    this.hud.spd.setText('×' + this.speed);
    this.hud.lv.setText('Lv.' + this.level);
    this.hud.kills.setText('击杀 ' + this.kills);
    // 经验条
    g.fillStyle(0x000000, .6).fillRect(0, 66, W, 8);
    g.fillStyle(0x3fd0ff).fillRect(0, 66, W * clamp(this.xp / this.xpNeed, 0, 1), 8);
    // 城墙血条
    const bw = 460, bx = (W - bw) / 2, by = 926, k = clamp(this.wall / this.mod.wallMax, 0, 1);
    g.fillStyle(0x000000, .75).fillRoundedRect(bx - 4, by - 4, bw + 8, 28, 8);
    g.fillStyle(this.wallFlash > 0 ? 0xff5a4a : k > .35 ? 0x3ddc5a : 0xe0a030).fillRoundedRect(bx, by, bw * k, 20, 6);
    this.hud.wallT.setText(`${Math.max(0, Math.ceil(this.wall))} / ${this.mod.wallMax}`);
    if (this.wallFlash > 0) this.wallFlash -= .016;
    // 弹匣
    const gs = this.gunStats();
    this.hud.ammo.setText(this.gun.reload > 0 ? '换弹…' : `${this.gun.ammo}/${gs.mag}`);
    // 最终技能：金色呼吸光圈
    const pulse = .5 + .5 * Math.sin(this.time.now / 220);
    this.skills.forEach((s, i) => {
      if (!s.br) return;
      const p = this.slotPos[i];
      g.lineStyle(3, 0xffd45a, .2 + .3 * pulse).strokeCircle(p.x, p.y, p.r + 4);
    });
    // 技能冷却
    this.skills.forEach((s, i) => {
      if (s.id === 'drone' || !s.cdTotal || s.t <= 0) return;
      const p = this.slotPos[i], f = clamp(s.t / s.cdTotal, 0, 1);
      g.fillStyle(0x000000, .55).slice(p.x, p.y, p.r - 2, -Math.PI / 2, -Math.PI / 2 + f * 6.283, false).fillPath();
    });
    // 首领血条
    const b = this.enemies.find(e => !e.dead && e.d.boss);
    this.hud.boss.setVisible(!!b);
    if (b) {
      this.hud.boss.setText(b.d.name);
      g.fillStyle(0x000000, .7).fillRoundedRect(90, 120, 360, 14, 5);
      g.fillStyle(0xe04a3a).fillRoundedRect(92, 122, 356 * clamp(b.hp / b.maxhp, 0, 1), 10, 4);
    }
  }

  /* ---------- 升级选择 ---------- */
  rollChoices() {
    const take = list => { const tot = list.reduce((a, c) => a + c.w, 0); let r = Math.random() * tot; for (const c of list) { r -= c.w; if (r <= 0) return c; } return list[0]; };
    const draw = (src, n) => { const out = []; src = src.slice(); while (out.length < n && src.length) { const c = take(src); out.push(c); src = src.filter(x => x !== c); } return out; };
    const newSkills = Object.keys(SKILLS).filter(id => !this.skill(id)).map(id => ({ kind: 'newSkill', id, w: 1 }));
    // 开局：3 个初始技能任选其一
    if (this.startPick) return draw(newSkills, 3).map(c => this.describe(c));
    const pool = [];
    const owned = this.skills.length;
    for (const s of this.skills) {
      if (!s.br && s.lv < MAX_SKILL) pool.push({ kind: 'upSkill', id: s.id, w: 3.6 });
    }
    if (owned < SLOTS) for (const c of newSkills) pool.push(Object.assign({}, c, { w: 3 }));
    if (this.gun.lv < MAX_GUN) pool.push({ kind: 'gun', id: 'gun', w: 2.4 });
    const pickN = draw(pool, 3);
    // 前 3 次升级（Lv2–4）保证至少有一张新技能卡
    if (this.level <= 4 && owned < SLOTS && !pickN.some(c => c.kind === 'newSkill')) {
      const cand = newSkills.filter(c => !pickN.some(p => p.id === c.id));
      if (cand.length) pickN[Math.min(2, pickN.length)] = Object.assign({}, pick(cand));
    }
    const fills = [{ kind: 'fill', id: 'repair', w: .8 }, { kind: 'fill', id: 'shock', w: .6 }, { kind: 'fill', id: 'xp', w: .5 }];
    pickN.push(...draw(fills, 3 - pickN.length));
    return pickN.map(c => this.describe(c));
  }
  describe(c) {
    const o = Object.assign({}, c);
    const branchHint = id => {
      const d = SKILLS[id];
      return `满级分支：${d.branches.a.name} / ${d.branches.b.name}`;
    };
    if (c.kind === 'newSkill') {
      const d = SKILLS[c.id];
      Object.assign(o, { name: d.name, glyph: d.glyph, color: d.color, tag: this.startPick ? '初始' : '新技能', sub: 'Lv 1', text: d.desc[0], diff: diffText(null, SKILL_STATS[c.id](1)), evo: branchHint(c.id) });
    } else if (c.kind === 'upSkill') {
      const d = SKILLS[c.id], s = this.skill(c.id), max = s.lv + 1 >= MAX_SKILL;
      Object.assign(o, { name: d.name, glyph: d.glyph, color: d.color, tag: max ? '满级' : '', sub: `Lv ${s.lv} → ${s.lv + 1}`, text: d.desc[s.lv], diff: diffText(SKILL_STATS[c.id](s.lv), SKILL_STATS[c.id](s.lv + 1)), evo: max ? '升到 Lv5 后自动二选一分支 → 最终技能' : branchHint(c.id) });
    } else if (c.kind === 'gun') {
      const l = this.gun.lv, gs = lv => { const g = this.gunStats(lv); return { 伤害: g.dmg, 弹匣: g.mag, 连发: g.shots, 射速: g.rate, 换弹: g.reload }; };
      Object.assign(o, { name: '主武器强化', glyph: '枪', color: 0x6b7686, sub: `Lv ${l} → ${l + 1}`, text: GUN_DESC[l + 1], diff: diffText(gs(l), gs(l + 1)) });
    } else {
      const m = { repair: ['紧急维修', '🧰', 0x4f9d69, '立即修复 40% 城墙'], shock: ['冲击波', '📣', 0xc98a2a, '对全屏敌人造成大量伤害并击退'], xp: ['战场情报', '📈', 0x3a9ad0, '立即获得大量经验'] }[c.id];
      Object.assign(o, { name: m[0], glyph: m[1], color: m[2], sub: '', text: m[3] });
    }
    return o;
  }
  showPick() {
    this.state = 'pick'; this.pickAt = this.time.now; SFX.play('levelup');
    this.curChest = !this.startPick && this.chestN > 0;
    const D = 100, ui = this.pickUI = [], add = o => { ui.push(o); return o; };
    add(this.add.rectangle(W / 2, H / 2, W, H, 0x000000, .78).setDepth(D).setInteractive());
    const title = this.startPick ? '选择初始技能' : this.curChest ? `🎁 宝箱奖励（剩 ${this.chestN}）` : `升级！ Lv.${this.level}`;
    add(this.add.rectangle(W / 2, 128, 440, 56, this.curChest ? 0xb8862a : 0xe0642a).setStrokeStyle(3, 0xffd45a).setDepth(D + 1));
    add(T(this, W / 2, 128, title, 30, '#fff').setOrigin(.5).setDepth(D + 2));
    const choices = this.rollChoices();
    choices.forEach((c, i) => {
      const y = 282 + i * 196, x = W / 2, cw = 500, ch = 184, tx = x - cw / 2 + 140;
      const g = add(this.add.graphics().setDepth(D + 1));
      g.fillStyle(0x1b2430).fillRoundedRect(x - cw / 2, y - ch / 2, cw, ch, 14);
      g.fillStyle(c.color, .9).fillRoundedRect(x - cw / 2, y - ch / 2, 10, ch, { tl: 14, bl: 14, tr: 0, br: 0 });
      g.lineStyle(3, c.tag === '满级' ? 0xffd45a : 0x3a475a).strokeRoundedRect(x - cw / 2, y - ch / 2, cw, ch, 14);
      add(this.add.circle(x - cw / 2 + 72, y - 10, 44, c.color, .3).setStrokeStyle(4, c.color).setDepth(D + 2));
      add(T(this, x - cw / 2 + 72, y - 10, c.glyph, 44, '#fff').setOrigin(.5).setDepth(D + 3));
      add(T(this, tx, y - 78, c.name, 28, '#fff').setDepth(D + 3));
      if (c.sub) add(T(this, tx, y - 42, c.sub, 18, '#ffd45a').setDepth(D + 3));
      add(T(this, tx, y - 16, c.text, 18, '#b8c6d6', { fontStyle: 'normal', wordWrap: { width: 340, useAdvancedWrap: true }, lineSpacing: 2 }).setDepth(D + 3));
      if (c.diff) add(T(this, tx, y + 32, c.diff, 15, '#8fe08a', { fontStyle: 'normal', wordWrap: { width: 345, useAdvancedWrap: true } }).setDepth(D + 3));
      if (c.evo) add(T(this, x - cw / 2 + 22, y + 64, c.evo, 15, '#8fd8ff', { fontStyle: 'normal' }).setDepth(D + 3));
      if (c.tag) {
        const tc = c.tag === '满级' ? 0xc99a1a : c.kind === 'newSkill' ? 0x3a8ad0 : 0xe0642a;
        add(this.add.rectangle(x + cw / 2 - 48, y - ch / 2 + 20, 76, 28, tc).setDepth(D + 3));
        add(T(this, x + cw / 2 - 48, y - ch / 2 + 20, c.tag, 17, '#fff').setOrigin(.5).setDepth(D + 4));
      }
      const z = add(this.add.zone(x, y, cw, ch).setDepth(D + 5).setInteractive());
      z.on('pointerdown', () => { if (this.time.now - this.pickAt > 350) this.choose(c); });
    });
    if (this.refresh > 0) {
      const b = add(this.add.rectangle(W / 2, 880, 260, 56, 0x23857a).setStrokeStyle(3, 0x6fe0d0).setDepth(D + 2).setInteractive());
      add(T(this, W / 2, 880, `🔄 刷新 (${this.refresh})`, 26, '#fff').setOrigin(.5).setDepth(D + 3));
      b.on('pointerdown', () => { if (this.time.now - this.pickAt > 250) { this.refresh--; this.closePick(); this.showPick(); } });
    }
    if (BOT) this.time.delayedCall(80, () => { if (this.state === 'pick') this.choose(this.botChoice(choices)); });
  }
  showBranch(id) {
    this.state = 'branch'; this.branchAt = this.time.now; SFX.play('levelup');
    const d = SKILLS[id], D = 130, ui = this.branchUI = [], add = o => { ui.push(o); return o; };
    add(this.add.rectangle(W / 2, H / 2, W, H, 0x000000, .85).setDepth(D).setInteractive());
    add(T(this, W / 2, 82, `${d.glyph} ${d.name} · 满级分支`, 34, '#fff').setOrigin(.5).setDepth(D + 1));
    add(T(this, W / 2, 130, '二选一，本局不可更改', 17, '#9fb4c8', { fontStyle: 'normal' }).setOrigin(.5).setDepth(D + 1));
    add(T(this, W / 2, 162, '终局强化：伤害 +10% · 冷却 -5% · 范围 +8% · 城墙 +250', 13, '#8fd8ff', { fontStyle: 'normal' }).setOrigin(.5).setDepth(D + 1));
    ['a', 'b'].forEach((k, i) => {
      const b = d.branches[k], y = 400 + i * 250, cw = 500, ch = 220, x = W / 2;
      const accent = k === 'a' ? 0x2f8fd6 : 0xb8452e, edge = k === 'a' ? 0x5ab0e8 : 0xe08a3c;
      const g = add(this.add.graphics().setDepth(D + 1));
      g.fillStyle(0x1b2430).fillRoundedRect(x - cw / 2, y - ch / 2, cw, ch, 14);
      g.lineStyle(3, edge).strokeRoundedRect(x - cw / 2, y - ch / 2, cw, ch, 14);
      add(this.add.rectangle(x - cw / 2 + 40, y - ch / 2 + 32, 54, 30, accent).setDepth(D + 3));
      add(T(this, x - cw / 2 + 40, y - ch / 2 + 32, k.toUpperCase(), 18, '#fff').setOrigin(.5).setDepth(D + 4));
      add(T(this, x - cw / 2 + 78, y - ch / 2 + 32, b.tag, 15, '#ffd45a').setOrigin(0, .5).setDepth(D + 4));
      add(T(this, x - cw / 2 + 40, y - 48, b.name, 30, '#fff').setOrigin(0, .5).setDepth(D + 3));
      add(T(this, x - cw / 2 + 40, y - 12, b.desc, 17, '#b8c6d6', { fontStyle: 'normal', wordWrap: { width: cw - 80, useAdvancedWrap: true }, lineSpacing: 4 }).setOrigin(0, 0).setDepth(D + 3));
      add(T(this, x - cw / 2 + 40, y + 72, 'Lv5 → 最终技能', 15, '#8fe08a', { fontStyle: 'normal' }).setOrigin(0, .5).setDepth(D + 3));
      const z = add(this.add.zone(x, y, cw, ch).setDepth(D + 5).setInteractive());
      z.on('pointerdown', () => { if (this.time.now - this.branchAt > 350) this.chooseBranch(id, k); });
    });
    add(T(this, W / 2, 880, '选择后立即生效', 15, '#6f8095', { fontStyle: 'normal' }).setOrigin(.5).setDepth(D + 1));
    if (BOT) this.time.delayedCall(120, () => { if (this.state === 'branch') this.chooseBranch(id, qs.get('branch') === 'b' ? 'b' : 'a'); });
  }
  chooseBranch(id, key) {
    if (this.state !== 'branch') return;
    const s = this.skill(id); if (!s || s.br) return;
    s.br = key;
    if (BOT) { window.__branches = window.__branches || []; window.__branches.push({ id, key }); }
    SFX.play('evo');
    this.cameras.main.flash(300, 255, 120, 255);
    for (const o of this.branchUI) o.destroy();
    this.branchUI = null;
    this.recalc(); this.syncDrones(); this.refreshSlots();
    if (this.branchQ.length) this.showBranch(this.branchQ.shift());
    else if (this.pending > 0) this.showPick();
    else this.state = 'play';
  }
  botChoice(cs) {
    const rank = { upSkill: 0, newSkill: 1, gun: 3, fill: 5 };
    return cs.slice().sort((a, b) => rank[a.kind] - rank[b.kind] + rnd(-.9, .9))[0];
  }
  closePick() { for (const o of this.pickUI) o.destroy(); this.pickUI = []; }
  choose(c) {
    SFX.play('select');
    switch (c.kind) {
      case 'newSkill': this.skills.push({ id: c.id, lv: 1, br: null, t: .4, cdTotal: 0 }); break;
      case 'upSkill': {
        const s = this.skill(c.id); s.lv++;
        if (s.lv >= MAX_SKILL && !s.br && !this.branchQ.includes(s.id)) this.branchQ.push(s.id);
        break;
      }
      case 'gun': this.gun.lv++; this.gun.ammo = this.gunStats().mag; break;
      default:
        if (c.id === 'repair') this.wall = Math.min(this.mod.wallMax, this.wall + this.mod.wallMax * .4);
        else if (c.id === 'xp') this.addXpNoPick(this.xpNeed * 1.2);
        else { for (const e of this.alive || []) if (!e.dead) this.dealDamage(e, 70, { color: '#fff', knock: 360, ignoreArmor: 1 }); this.fxRing(W / 2, 600, 700, 0xffffff); this.cameras.main.shake(200, .008); }
    }
    if (this.curChest) this.chestN--;
    this.startPick = false; this.curChest = false;
    this.recalc(); this.syncDrones(); this.refreshSlots();
    this.closePick();
    this.pending--;
    if (this.branchQ.length) this.showBranch(this.branchQ.shift());
    else if (this.pending > 0) this.showPick();
    else this.state = 'play';
  }
  addXpNoPick(v) {
    this.xp += v;
    while (this.xp >= this.xpNeed) { this.xp -= this.xpNeed; this.level++; this.xpNeed = this.needXp(this.level); this.pending++; }
  }

  /* ---------- 暂停 / 结束 ---------- */
  togglePause() {
    if (this.state === 'play') {
      this.prevState = 'play'; this.state = 'pause'; this.tweens.pauseAll();
      const D = 100, ui = this.pauseUI = [];
      ui.push(this.add.rectangle(W / 2, H / 2, W, H, 0x000000, .75).setDepth(D).setInteractive());
      ui.push(T(this, W / 2, 300, '已暂停', 56, '#fff').setOrigin(.5).setDepth(D + 1));
      this.btn(ui, W / 2, 430, '继续', 0x23857a, () => this.togglePause());
      this.btn(ui, W / 2, 525, '分支图鉴', 0x8a3ac0, () => this.showCodex());
      this.btn(ui, W / 2, 620, '重新开始', 0xe0642a, () => this.scene.restart());
      this.btn(ui, W / 2, 715, '回到主菜单', 0x4a5568, () => this.scene.start('Menu'));
    } else if (this.state === 'pause') {
      if (this.codexUI) { for (const o of this.codexUI) o.destroy(); this.codexUI = null; }
      for (const o of this.pauseUI) o.destroy();
      this.state = 'play'; this.tweens.resumeAll();
    }
  }
  showCodex() {
    if (this.codexUI) return;
    const D = 110, ui = this.codexUI = [];
    ui.push(this.add.rectangle(W / 2, H / 2, W, H, 0x0b0f15, .97).setDepth(D).setInteractive());
    ui.push(T(this, W / 2, 64, '技能分支图鉴', 38, '#ffd45a').setOrigin(.5).setDepth(D + 1));
    ui.push(T(this, W / 2, 106, '技能升到 Lv5 后自动二选一，选定即成为最终技能（本局不可更改）\n每完成一个最终技能，获得一层终局强化', 14, '#9fb4c8', { fontStyle: 'normal', align: 'center', wordWrap: { width: 500, useAdvancedWrap: true }, lineSpacing: 4 }).setOrigin(.5, 0).setDepth(D + 1));
    Object.keys(SKILLS).forEach((id, i) => {
      const d = SKILLS[id], s = this.skill(id), y = 176 + i * 100;
      const g = this.add.graphics().setDepth(D + 1);
      g.fillStyle(0x1b2430).fillRoundedRect(16, y - 42, W - 32, 84, 12);
      g.lineStyle(2, s && s.br ? 0xffd45a : 0x3a475a).strokeRoundedRect(16, y - 42, W - 32, 84, 12);
      ui.push(g);
      ui.push(this.add.circle(52, y - 4, 21, s ? d.color : 0x2a3340, s ? .5 : .15).setStrokeStyle(2, s ? d.color : 0x3a475a).setDepth(D + 2));
      ui.push(T(this, 52, y - 5, d.glyph, 21, '#fff').setOrigin(.5).setDepth(D + 3).setAlpha(s ? 1 : .4));
      ui.push(T(this, 52, y + 28, d.name, 12, s ? '#fff' : '#6a7686').setOrigin(.5).setDepth(D + 3));
      ui.push(T(this, 92, y - 14, s ? (s.br ? '最终' : 'Lv' + s.lv) : '未获得', 13, s ? (s.br ? '#ffd45a' : '#9fb4c8') : '#5a6a80', { fontStyle: 'normal' }).setDepth(D + 3));
      ['a', 'b'].forEach((k, j) => {
        const b = d.branches[k], x = 150 + j * 188, w = 176;
        const on = !!(s && s.br === k), dim = !s;
        const gg = this.add.graphics().setDepth(D + 1);
        gg.fillStyle(on ? 0x3a2f14 : 0x10151c, .9).fillRoundedRect(x, y - 30, w, 60, 10);
        gg.lineStyle(on ? 2 : 1, on ? 0xffd45a : 0x3a475a).strokeRoundedRect(x, y - 30, w, 60, 10);
        ui.push(gg);
        ui.push(T(this, x + 10, y - 18, k.toUpperCase() + ' · ' + b.name, 15, on ? '#ffd45a' : dim ? '#6a7686' : '#fff').setDepth(D + 3));
        ui.push(T(this, x + 10, y + 6, on ? '已选 ✓' : dim ? '未获得' : (s && s.lv >= MAX_SKILL ? '待选择' : '满级可选'), 12, on ? '#8fe08a' : dim ? '#5a6a80' : '#9fb4c8', { fontStyle: 'normal' }).setDepth(D + 3));
      });
    });
    this.btn(ui, W / 2, 820, '返回', 0x4a5568, () => { for (const o of ui) o.destroy(); this.codexUI = null; }, D + 5);
  }
  btn(ui, x, y, label, color, fn, d = 101) {
    const b = this.add.rectangle(x, y, 300, 70, color).setStrokeStyle(3, 0xffffff, .6).setDepth(d).setInteractive();
    ui.push(b, T(this, x, y, label, 30, '#fff').setOrigin(.5).setDepth(d + 1));
    b.on('pointerdown', fn);
  }
  endGame(win) {
    if (this.state === 'end') return;
    this.state = 'end'; SFX.play(win ? 'win' : 'lose');
    const reached = this.wave;
    try { const best = +(localStorage.getItem('zd_best') || 0); if (reached > best) localStorage.setItem('zd_best', reached); } catch (e) {}
    const D = 100, ui = this.endUI = [];
    ui.push(this.add.rectangle(W / 2, H / 2, W, H, 0x000000, .8).setDepth(D).setInteractive());
    ui.push(T(this, W / 2, 230, win ? '防线守住了！' : '防线失守…', 60, win ? '#ffd45a' : '#ff6a5a', { stroke: '#000', strokeThickness: 8 }).setOrigin(.5).setDepth(D + 1));
    const sk = this.skills.map(s => `${s.br ? SKILLS[s.id].branches[s.br].name : SKILLS[s.id].name} Lv${s.lv}`).join('  ·  ') || '无';
    const wv = this.endless ? `无尽模式 第 ${reached} 波` : `${reached}/${MAXW}`;
    ui.push(T(this, W / 2, 340, `到达波次  ${wv}\n用时  ${fmtTime(this.t)}\n击杀  ${this.kills}\n等级  Lv.${this.level}\n\n${sk}`, 26, '#dfe8f2', { align: 'center', lineSpacing: 12, wordWrap: { width: 480 } }).setOrigin(.5, 0).setDepth(D + 1));
    if (win) this.btn(ui, W / 2, 690, '进入无尽模式', 0x8a3ac0, () => this.goEndless());
    this.btn(ui, W / 2, win ? 785 : 700, '再来一局', 0xe0642a, () => this.scene.restart());
    this.btn(ui, W / 2, win ? 880 : 800, '回到主菜单', 0x4a5568, () => this.scene.start('Menu'));
    if (BOT) { window.__result = { win, wave: reached, t: this.t, kills: this.kills, level: this.level, skills: sk, waves: window.__waves }; }
  }
  goEndless() {
    for (const o of this.endUI) o.destroy(); this.endUI = null;
    this.endless = true; this.state = 'play'; this.waveT = WAVE_LEN;   // 立刻开始下一波
    this.wall = this.mod.wallMax;
    this.banner('无尽模式', '#e6a6ff');
  }
}

/* ============================== 启动 ============================== */
window.__game = new Phaser.Game({
  type: Phaser.AUTO, parent: 'game', backgroundColor: '#0d1117',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH, width: W * RES, height: H * RES },
  render: { antialias: true, powerPreference: 'high-performance' },
  fps: { target: 60 }, input: { activePointers: 1 },
  scene: [Boot, Menu, Game],
});
})();
