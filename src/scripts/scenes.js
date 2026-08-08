// 预设场景：用 engine.js 的原语搭出几个能上手玩的局面。
// 原则是宁可少几个场景，也要每个都手感对。

import { World, Body } from './engine.js';

const TAU = Math.PI * 2;

// ---------------------------------------------------------------- 造物原语

/** 果冻球：一圈质点 + 圆心质点，靠压强撑起来，戳一下会弹很久。 */
export function makeBlob(w, cx, cy, radius, n, color, opts = {}) {
  const body = new Body({
    kind: 'soft',
    color,
    usePressure: true,
    shapeMatch: opts.shapeMatch ?? 0.04,
  });
  const spacing = (TAU * radius) / n;
  const pr = Math.max(6, spacing * 0.55);
  const ring = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    ring.push(w.addParticle(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius, 1, pr));
  }
  const center = w.addParticle(cx, cy, 1, pr * 0.6);
  body.particles = [...ring, center];
  body.outline = ring;
  for (let i = 0; i < n; i++) {
    w.addSpring(ring[i], ring[(i + 1) % n], 1);
    w.addSpring(ring[i], ring[(i + 2) % n], 0.55);
    w.addSpring(ring[i], center, 0.45);
  }
  w.addBody(body);
  w.captureRest(body);
  body.areaTarget = w.signedArea(body);
  return body;
}

/** 果冻方块：沿圆角矩形均匀取点，同样吃压强。 */
export function makeJellyBox(w, cx, cy, width, height, color, opts = {}) {
  const body = new Body({
    kind: 'soft',
    color,
    usePressure: true,
    shapeMatch: opts.shapeMatch ?? 0.06,
  });
  const perSide = opts.perSide ?? 5;
  const hw = width / 2;
  const hh = height / 2;
  const corners = [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ];
  const ring = [];
  for (let c = 0; c < 4; c++) {
    const [x0, y0] = corners[c];
    const [x1, y1] = corners[(c + 1) % 4];
    for (let s = 0; s < perSide; s++) {
      const t = s / perSide;
      ring.push(w.addParticle(cx + x0 + (x1 - x0) * t, cy + y0 + (y1 - y0) * t, 1, 9));
    }
  }
  const center = w.addParticle(cx, cy, 1, 6);
  const n = ring.length;
  body.particles = [...ring, center];
  body.outline = ring;
  for (let i = 0; i < n; i++) {
    w.addSpring(ring[i], ring[(i + 1) % n], 1);
    w.addSpring(ring[i], ring[(i + 2) % n], 0.5);
    w.addSpring(ring[i], center, 0.4);
    // 对角内部弹簧（原项目的 internal springs），撑住方形不塌成圆
    w.addSpring(ring[i], ring[(i + n / 2) % n | 0], 0.35);
  }
  w.addBody(body);
  w.captureRest(body);
  body.areaTarget = w.signedArea(body);
  return body;
}

/** 刚体箱子：8 个外圈质点 + 全连接硬弹簧 + 形状匹配拉满，堆起来不倒。 */
export function makeRigidBox(w, cx, cy, width, height, color, opts = {}) {
  const body = new Body({ kind: 'rigid', color, shapeMatch: opts.shapeMatch ?? 1 });
  const hw = width / 2;
  const hh = height / 2;
  const pts = [
    [-hw, -hh],
    [0, -hh],
    [hw, -hh],
    [hw, 0],
    [hw, hh],
    [0, hh],
    [-hw, hh],
    [-hw, 0],
  ];
  const ring = pts.map(([dx, dy]) => w.addParticle(cx + dx, cy + dy, 1, opts.pr ?? 7));
  body.particles = ring;
  body.outline = ring;
  // 全连接：任意两点都拉一根硬弹簧（k=-1 表示不吃刚度滑块）
  for (let i = 0; i < ring.length; i++) {
    for (let j = i + 1; j < ring.length; j++) w.addSpring(ring[i], ring[j], -1);
  }
  w.addBody(body);
  w.captureRest(body);
  return body;
}

/** 静态平台 / 斜坡：质点全部钉死，但仍参与多边形碰撞。 */
export function makeStatic(w, cx, cy, width, height, angle = 0, color = '#2b3450') {
  const body = new Body({ kind: 'static', color, static: true });
  const hw = width / 2;
  const hh = height / 2;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const pts = [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ];
  const ring = pts.map(([dx, dy]) =>
    w.addParticle(cx + dx * c - dy * s, cy + dx * s + dy * c, 0, 4)
  );
  body.particles = ring;
  body.outline = ring;
  w.addBody(body);
  return body;
}

/** 绳 / 弹簧链：一串质点，可选钉住头部。 */
export function makeRope(w, x0, y0, x1, y1, segments, color, opts = {}) {
  const body = new Body({ kind: 'rope', color });
  const ids = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const pinned = i === 0 && opts.pinFirst !== false;
    ids.push(w.addParticle(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, pinned ? 0 : 1, opts.pr ?? 8));
  }
  for (let i = 0; i < segments; i++) w.addSpring(ids[i], ids[i + 1], opts.k ?? 1);
  body.particles = ids;
  body.chain = ids;
  w.addBody(body);
  return body;
}

/** 关节：把两个物体上离得最近的质点用硬弹簧连起来（对应 qjoint）。 */
function joint(w, a, b, k = -1) {
  w.addSpring(a, b, k);
}

function nearestPair(w, bodyA, bodyB) {
  let best = Infinity;
  let pair = [bodyA.particles[0], bodyB.particles[0]];
  for (const i of bodyA.particles) {
    for (const j of bodyB.particles) {
      const d = (w.particles[i].x - w.particles[j].x) ** 2 + (w.particles[i].y - w.particles[j].y) ** 2;
      if (d < best) {
        best = d;
        pair = [i, j];
      }
    }
  }
  return pair;
}

// ---------------------------------------------------------------- 场景

const PALETTE = {
  jelly: '#4de2ff',
  jelly2: '#ff5fa8',
  jelly3: '#b98bff',
  jelly4: '#6cf3a0',
  box: '#ffc861',
  rope: '#8ea4c8',
};

/** 场景一：果冻广场。四坨软体，戳一下弹半天。 */
function sceneJelly(w) {
  const { w: W, h: H } = w.bounds;
  // 一块平台 + 一道斜坡，让果冻掉下来之后还有得滚，画面不会一上来就静止
  makeStatic(w, W * 0.44, H * 0.68, W * 0.34, 18, 0);
  // 斜坡朝画面中心倾斜，果冻从高处滚下来会滚回场中，不会卡在墙角
  makeStatic(w, W * 0.8, H * 0.42, W * 0.3, 16, -0.4);

  makeJellyBox(w, W * 0.42, H * 0.14, Math.min(118, W * 0.19), Math.min(118, W * 0.19), PALETTE.jelly3, {
    perSide: 5,
  });
  makeBlob(w, W * 0.2, H * 0.3, Math.min(76, W * 0.125), 20, PALETTE.jelly);
  makeBlob(w, W * 0.6, H * 0.2, Math.min(50, W * 0.088), 18, PALETTE.jelly2);
  makeBlob(w, W * 0.89, H * 0.1, Math.min(42, W * 0.075), 16, PALETTE.jelly4);
}

/** 场景二：弹簧链。吊着的果冻球 + 一串珠子，抡起来砸箱子。 */
function sceneChain(w) {
  const { w: W, h: H } = w.bounds;
  const anchorY = H * 0.08;
  // 一条软弹簧链，末端挂一坨果冻
  const chain = makeRope(w, W * 0.32, anchorY, W * 0.32, H * 0.42, 8, PALETTE.rope, { k: 1 });
  const ball = makeBlob(w, W * 0.32, H * 0.48, Math.min(52, W * 0.09), 18, PALETTE.jelly2);
  joint(w, chain.particles[chain.particles.length - 1], ball.outline[Math.floor(ball.outline.length * 0.75)]);

  // 另一条更长更软的链，末端是个刚体块
  const chain2 = makeRope(w, W * 0.68, anchorY, W * 0.68, H * 0.4, 10, PALETTE.rope, { k: 0.7 });
  const wgt = makeRigidBox(w, W * 0.68, H * 0.48, 62, 62, PALETTE.box);
  joint(w, chain2.particles[chain2.particles.length - 1], wgt.particles[1]);

  // 底下摆几个箱子给你砸
  const bw = Math.min(58, W * 0.1);
  for (let i = 0; i < 4; i++) {
    makeRigidBox(w, W * (0.36 + i * 0.09), H * 0.9 - bw * 0.5, bw, bw, PALETTE.box);
  }
}

/** 场景三：箱子堆叠。金字塔 + 一颗吊着的果冻拆迁球。 */
function sceneStack(w) {
  const { w: W, h: H } = w.bounds;
  const bw = Math.min(56, W * 0.095);
  const rows = 4;
  const baseY = H * 0.92 - bw * 0.5;
  const cx = W * 0.62;
  for (let r = 0; r < rows; r++) {
    const count = rows - r;
    for (let i = 0; i < count; i++) {
      const x = cx + (i - (count - 1) / 2) * (bw + 3);
      makeRigidBox(w, x, baseY - r * (bw + 2), bw, bw, PALETTE.box);
    }
  }
  // 拆迁球：长链 + 大果冻
  const chain = makeRope(w, W * 0.16, H * 0.06, W * 0.16, H * 0.4, 10, PALETTE.rope, { k: 1 });
  const ball = makeBlob(w, W * 0.16, H * 0.5, Math.min(58, W * 0.1), 18, PALETTE.jelly);
  joint(w, chain.particles[chain.particles.length - 1], ball.outline[Math.floor(ball.outline.length * 0.75)]);
}

/** 场景四：布袋娃娃。躯干 + 头 + 四肢，用关节串起来，拎着头甩。 */
function sceneRagdoll(w) {
  const { w: W, h: H } = w.bounds;
  const s = Math.min(1, W / 760);
  const cx = W * 0.5;
  const cy = H * 0.3;
  const torso = makeRigidBox(w, cx, cy, 62 * s, 92 * s, PALETTE.jelly3, { pr: 8 });
  const head = makeBlob(w, cx, cy - 78 * s, 30 * s, 14, PALETTE.jelly);
  const [ha, hb] = nearestPair(w, head, torso);
  joint(w, ha, hb);
  // 脖子加第二根，防止脑袋原地打转
  joint(w, head.outline[0], torso.particles[0], -1);

  const limbs = [
    { x: -52 * s, y: -14 * s, wdt: 26 * s, hgt: 74 * s }, // 左臂
    { x: 52 * s, y: -14 * s, wdt: 26 * s, hgt: 74 * s }, // 右臂
    { x: -22 * s, y: 96 * s, wdt: 28 * s, hgt: 86 * s }, // 左腿
    { x: 22 * s, y: 96 * s, wdt: 28 * s, hgt: 86 * s }, // 右腿
  ];
  for (const l of limbs) {
    const limb = makeRigidBox(w, cx + l.x, cy + l.y, l.wdt, l.hgt, PALETTE.jelly4, { pr: 7 });
    const [a, b] = nearestPair(w, limb, torso);
    joint(w, a, b);
    // 第二根关节限制摆幅，肢体不会 360 度乱转
    const [a2, b2] = nearestPair2(w, limb, torso, a, b);
    joint(w, a2, b2, 0.5);
  }
  makeStatic(w, W * 0.5, H * 0.95, W * 0.9, 24, 0);
  // 边上丢两个箱子，方便看娃娃跟刚体的互动
  makeRigidBox(w, W * 0.16, H * 0.85, 54 * s, 54 * s, PALETTE.box);
  makeRigidBox(w, W * 0.86, H * 0.85, 54 * s, 54 * s, PALETTE.box);
}

/** 找第二近的一对质点，跳过已用过的那对。 */
function nearestPair2(w, bodyA, bodyB, skipA, skipB) {
  let best = Infinity;
  let pair = [bodyA.particles[0], bodyB.particles[0]];
  for (const i of bodyA.particles) {
    for (const j of bodyB.particles) {
      if (i === skipA && j === skipB) continue;
      if (i === skipA || j === skipB) continue;
      const d = (w.particles[i].x - w.particles[j].x) ** 2 + (w.particles[i].y - w.particles[j].y) ** 2;
      if (d < best) {
        best = d;
        pair = [i, j];
      }
    }
  }
  return pair;
}

export const SCENES = [
  {
    id: 'jelly',
    name: '果冻广场',
    hint: '拖着甩，或者点空白处戳一下 —— 面积约束会把它撑回原状',
    build: sceneJelly,
    defaults: { stiffness: 0.7, damping: 0.999, gravity: 1700, pressure: 1 },
  },
  {
    id: 'chain',
    name: '弹簧链',
    hint: '把球抡起来砸箱子。链子就是一串距离约束',
    build: sceneChain,
    defaults: { stiffness: 0.9, damping: 0.998, gravity: 1800, pressure: 1 },
  },
  {
    id: 'stack',
    name: '箱子堆叠',
    hint: '刚体靠形状匹配保持方形，堆四层不倒；拿左边的球拆了它',
    build: sceneStack,
    defaults: { stiffness: 1, damping: 0.997, gravity: 2000, pressure: 1 },
  },
  {
    id: 'ragdoll',
    name: '布袋娃娃',
    hint: '拎着脑袋甩。关节 = 跨物体的硬距离约束',
    build: sceneRagdoll,
    defaults: { stiffness: 1, damping: 0.996, gravity: 1900, pressure: 1 },
  },
];

/** 按 id 造一个新世界。 */
export function buildWorld(sceneId, width, height) {
  const scene = SCENES.find((s) => s.id === sceneId) || SCENES[0];
  const w = new World();
  w.bounds = { w: width, h: height };
  Object.assign(w, scene.defaults);
  scene.build(w);
  return { world: w, scene };
}
