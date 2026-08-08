// 软体物理内核：用 JS 按 QuarkPhysics 的算法思路重新实现，不是移植。
//
// 对照原项目（erayzesen/QuarkPhysics，C++）的模块：
//   qparticle    -> Particle      质点，Verlet 积分
//   qspring      -> springs[]     距离约束（mass-spring model）
//   qareabody    -> areaTarget    面积/压强约束（area-volume preserving）
//   qsoftbody    -> Body          形状匹配（shape matching）+ PBD dynamics
//   qcollision   -> 多边形推出 + 质点圆碰撞
//
// 求解器是 PBD（Position Based Dynamics）：先做无约束积分，再反复把位置
// 投影回满足约束的地方，速度由「当前位置 - 上一帧位置」隐式得到。

/** 质点。x/y 是当前位置，px/py 是上一子步位置，两者之差即速度。 */
export class Particle {
  constructor(x, y, invMass = 1, radius = 7) {
    this.x = x;
    this.y = y;
    this.px = x;
    this.py = y;
    this.invMass = invMass; // 0 表示钉死不动
    this.r = radius;
    this.body = -1; // 所属刚体/软体的下标，用于跳过自碰撞
  }
}

/** 一个物体：一组质点 + 可选的闭合轮廓 + 可选的面积约束和形状匹配。 */
export class Body {
  constructor(opts = {}) {
    this.idx = -1;
    this.particles = []; // 全局质点下标
    this.outline = []; // 闭合轮廓上的全局质点下标（按环序），空表示不参与多边形碰撞
    this.rest = null; // 形状匹配的静止形状（已相对质心居中）
    this.shapeMatch = opts.shapeMatch ?? 0; // 0~1，1 接近刚体
    this.areaTarget = opts.areaTarget ?? 0; // 静止有向面积，0 表示不做面积约束
    this.usePressure = opts.usePressure ?? false; // 是否吃压强滑块
    this.softness = opts.softness ?? 1; // 该物体对全局刚度的缩放
    this.kind = opts.kind || 'soft'; // soft / rigid / static / rope
    this.color = opts.color || '#4dd8ff';
    this.static = opts.static ?? false;
    this.aabb = { x0: 0, y0: 0, x1: 0, y1: 0 };
  }
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class World {
  constructor() {
    this.particles = [];
    this.bodies = [];
    this.springs = []; // {a, b, rest, k} —— a/b 是全局质点下标，可跨物体（等价于 qjoint）
    this.gravity = 1700;
    this.stiffness = 0.85;
    this.damping = 0.999;
    this.pressure = 1;
    this.substeps = 6;
    this.iterations = 3;
    this.bounds = { w: 800, h: 600 };
    this.grab = null; // {p, x, y}
    this.time = 0;
  }

  addParticle(x, y, invMass = 1, radius = 7) {
    const p = new Particle(x, y, invMass, radius);
    this.particles.push(p);
    return this.particles.length - 1;
  }

  addSpring(a, b, k = 1, restOverride = null) {
    const pa = this.particles[a];
    const pb = this.particles[b];
    const rest = restOverride ?? Math.hypot(pa.x - pb.x, pa.y - pb.y);
    this.springs.push({ a, b, rest, k });
  }

  addBody(body) {
    body.idx = this.bodies.length;
    this.bodies.push(body);
    for (const i of body.particles) this.particles[i].body = body.idx;
    return body;
  }

  /** 记录当前姿态为形状匹配的静止形状。 */
  captureRest(body) {
    let cx = 0;
    let cy = 0;
    for (const i of body.particles) {
      cx += this.particles[i].x;
      cy += this.particles[i].y;
    }
    cx /= body.particles.length;
    cy /= body.particles.length;
    body.rest = body.particles.map((i) => ({
      x: this.particles[i].x - cx,
      y: this.particles[i].y - cy,
    }));
  }

  /** 轮廓围成的有向面积（screen 坐标 y 向下，符号只用于保持一致性）。 */
  signedArea(body) {
    const o = body.outline;
    let a = 0;
    for (let i = 0; i < o.length; i++) {
      const p = this.particles[o[i]];
      const q = this.particles[o[(i + 1) % o.length]];
      a += p.x * q.y - q.x * p.y;
    }
    return a * 0.5;
  }

  // ---------------------------------------------------------------- 主循环

  step(dt) {
    const h = dt / this.substeps;
    for (let s = 0; s < this.substeps; s++) this.substep(h);
    this.time += dt;
  }

  substep(h) {
    const g = this.gravity * h * h;
    const damp = this.damping;
    // ① 无约束积分（Verlet）
    for (const p of this.particles) {
      if (p.invMass === 0) {
        p.px = p.x;
        p.py = p.y;
        continue;
      }
      const vx = (p.x - p.px) * damp;
      const vy = (p.y - p.py) * damp;
      p.px = p.x;
      p.py = p.y;
      p.x += vx;
      p.y += vy + g;
    }

    // ② 约束投影，迭代若干轮
    for (let it = 0; it < this.iterations; it++) {
      this.solveSprings();
      for (const b of this.bodies) {
        if (b.static) continue;
        if (b.areaTarget) this.solveArea(b);
        if (b.shapeMatch > 0) this.solveShapeMatch(b);
      }
      this.solveGrab();
      // 摩擦只在每个子步的最后一轮迭代施加一次。
      // 如果每轮迭代都施加，一帧就会叠加 6×3=18 次，所有东西都会被黏死在原地：
      // 果冻停在斜坡上不往下滚，扔出去的东西一落地就不动了。
      const last = it === this.iterations - 1;
      this.solveCollisions(last);
      this.solveBounds(last);
    }
  }

  // 距离约束：QuarkPhysics 里的 spring / joint
  solveSprings() {
    const base = this.stiffness;
    // 迭代补偿：一帧里约束会被求解 substeps×iterations = 18 次，
    // 直接用滑块值会让 0.05 也硬得像 0.6（每次都拉一点，18 次就拉满了）。
    // 换算成每次迭代的强度，滑块数值才等于「每帧真正的刚度」，拉到最低才是真的软。
    const n = this.substeps * this.iterations;
    for (const s of this.springs) {
      const pa = this.particles[s.a];
      const pb = this.particles[s.b];
      const wsum = pa.invMass + pb.invMass;
      if (wsum === 0) continue;
      let dx = pb.x - pa.x;
      let dy = pb.y - pa.y;
      let d = Math.hypot(dx, dy);
      if (d < 1e-6) continue;
      // s.k < 0 表示这根是「硬连接」（关节 / 刚体骨架），不吃刚度滑块
      let k = s.k < 0 ? 1 : clamp(base * s.k, 0.02, 1);
      // 防自交保护：被压到静止长度 65% 以下时按全强度弹回，不再听刚度滑块。
      // 否则低刚度 / 低压强下轮廓会被挤得互相穿过，渲染出一个个小环，一眼穿帮。
      if (s.k >= 0 && d < s.rest * 0.65) k = 1;
      if (k < 1) k = 1 - Math.pow(1 - k, 1 / n);
      const diff = ((d - s.rest) / d) * k;
      dx *= diff;
      dy *= diff;
      const wa = pa.invMass / wsum;
      const wb = pb.invMass / wsum;
      pa.x += dx * wa;
      pa.y += dy * wa;
      pb.x -= dx * wb;
      pb.y -= dy * wb;
    }
  }

  // 面积约束：闭合轮廓的面积被拉回 静止面积 × 压强（area-volume preserving）
  solveArea(body) {
    const o = body.outline;
    const n = o.length;
    if (n < 3) return;
    const target = body.areaTarget * (body.usePressure ? this.pressure : 1);
    const cur = this.signedArea(body);
    const C = cur - target;
    // 梯度：dA/dp_i = 0.5 * (y_{i+1}-y_{i-1}, x_{i-1}-x_{i+1})
    let denom = 0;
    const gx = new Array(n);
    const gy = new Array(n);
    for (let i = 0; i < n; i++) {
      const prev = this.particles[o[(i - 1 + n) % n]];
      const next = this.particles[o[(i + 1) % n]];
      const p = this.particles[o[i]];
      gx[i] = 0.5 * (next.y - prev.y);
      gy[i] = 0.5 * (prev.x - next.x);
      denom += p.invMass * (gx[i] * gx[i] + gy[i] * gy[i]);
    }
    if (denom < 1e-9) return;
    // 压强本身用较高的刚度，否则果冻会被压扁再也弹不回来
    const k = clamp(0.35 + this.stiffness * 0.6, 0, 1);
    const lambda = (-C / denom) * k;
    for (let i = 0; i < n; i++) {
      const p = this.particles[o[i]];
      if (p.invMass === 0) continue;
      p.x += lambda * p.invMass * gx[i];
      p.y += lambda * p.invMass * gy[i];
    }
  }

  // 形状匹配：求最贴合静止形状的刚性变换，再把质点往目标位置拉
  solveShapeMatch(body) {
    const ids = body.particles;
    const rest = body.rest;
    if (!rest) return;
    let cx = 0;
    let cy = 0;
    for (const i of ids) {
      cx += this.particles[i].x;
      cy += this.particles[i].y;
    }
    cx /= ids.length;
    cy /= ids.length;
    let D = 0;
    let S = 0;
    for (let i = 0; i < ids.length; i++) {
      const p = this.particles[ids[i]];
      const qx = p.x - cx;
      const qy = p.y - cy;
      D += qx * rest[i].x + qy * rest[i].y;
      S += qy * rest[i].x - qx * rest[i].y;
    }
    const theta = Math.atan2(S, D);
    const c = Math.cos(theta);
    const sn = Math.sin(theta);
    // 刚体的形状匹配不受刚度滑块影响，软体的受影响（滑到最软会瘫成一坨）
    const alpha =
      body.kind === 'rigid'
        ? body.shapeMatch
        : clamp(body.shapeMatch * (0.25 + this.stiffness * 0.9), 0, 1);
    for (let i = 0; i < ids.length; i++) {
      const p = this.particles[ids[i]];
      if (p.invMass === 0) continue;
      const gxp = cx + (rest[i].x * c - rest[i].y * sn);
      const gyp = cy + (rest[i].x * sn + rest[i].y * c);
      p.x += (gxp - p.x) * alpha;
      p.y += (gyp - p.y) * alpha;
    }
  }

  // 鼠标抓取：直接把被抓的质点拉向指针，速度由 Verlet 隐式继承，所以能甩能扔
  solveGrab() {
    const g = this.grab;
    if (!g) return;
    const p = this.particles[g.p];
    p.x += (g.x - p.x) * 0.55;
    p.y += (g.y - p.y) * 0.55;
  }

  // -------------------------------------------------------------- 碰撞

  updateAABB() {
    for (const b of this.bodies) {
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const i of b.particles) {
        const p = this.particles[i];
        if (p.x - p.r < x0) x0 = p.x - p.r;
        if (p.y - p.r < y0) y0 = p.y - p.r;
        if (p.x + p.r > x1) x1 = p.x + p.r;
        if (p.y + p.r > y1) y1 = p.y + p.r;
      }
      b.aabb = { x0, y0, x1, y1 };
    }
  }

  solveCollisions(friction = false) {
    this.updateAABB();
    const bodies = this.bodies;
    for (let bi = 0; bi < bodies.length; bi++) {
      const B = bodies[bi];
      if (B.outline.length < 3) continue;
      const box = B.aabb;
      for (let bj = 0; bj < bodies.length; bj++) {
        if (bj === bi) continue;
        const O = bodies[bj];
        if (O.static && B.static) continue;
        const ob = O.aabb;
        if (ob.x1 < box.x0 || ob.x0 > box.x1 || ob.y1 < box.y0 || ob.y0 > box.y1) continue;
        for (const pi of O.particles) {
          this.resolveParticleInBody(this.particles[pi], B, friction);
        }
      }
    }
    this.solveParticlePairs();
  }

  /** 质点掉进别人多边形里 -> 沿最近边推出，反作用力按质量分给这条边的两个端点。 */
  resolveParticleInBody(p, B, friction = false) {
    // 注意：这里**不能**在 p.invMass === 0 时直接 return。
    // 静态平台的角点落进果冻内部时，也要把果冻的边推开，
    // 否则薄斜坡 / 薄平台会被软体直接穿过去（质点跨在薄板两侧，谁也没落进对方内部）。
    const box = B.aabb;
    if (p.x < box.x0 || p.x > box.x1 || p.y < box.y0 || p.y > box.y1) return;
    const o = B.outline;
    const n = o.length;
    // 射线法判断是否在多边形内
    let inside = false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const a = this.particles[o[i]];
      const b = this.particles[o[j]];
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
        inside = !inside;
      }
    }
    if (!inside) return;
    // 找最近的边
    let best = Infinity;
    let bx = 0;
    let by = 0;
    let bt = 0;
    let bi = -1;
    for (let i = 0; i < n; i++) {
      const a = this.particles[o[i]];
      const b = this.particles[o[(i + 1) % n]];
      const ex = b.x - a.x;
      const ey = b.y - a.y;
      const len2 = ex * ex + ey * ey;
      if (len2 < 1e-9) continue;
      let t = ((p.x - a.x) * ex + (p.y - a.y) * ey) / len2;
      t = clamp(t, 0, 1);
      const cxp = a.x + ex * t;
      const cyp = a.y + ey * t;
      const d = (cxp - p.x) ** 2 + (cyp - p.y) ** 2;
      if (d < best) {
        best = d;
        bx = cxp;
        by = cyp;
        bt = t;
        bi = i;
      }
    }
    if (bi < 0) return;
    const a = this.particles[o[bi]];
    const b = this.particles[o[(bi + 1) % n]];
    let nx = bx - p.x;
    let ny = by - p.y;
    const d = Math.hypot(nx, ny);
    if (d < 1e-6) return;
    nx /= d;
    ny /= d;
    const depth = d; // 推到边上即可
    const wa = (1 - bt) * a.invMass;
    const wb = bt * b.invMass;
    const wsum = p.invMass + wa * (1 - bt) + wb * bt;
    if (wsum < 1e-9) return;
    const scale = depth / wsum;
    p.x += nx * scale * p.invMass;
    p.y += ny * scale * p.invMass;
    a.x -= nx * scale * wa;
    a.y -= ny * scale * wa;
    b.x -= nx * scale * wb;
    b.y -= ny * scale * wb;
    // 切向摩擦：削掉一点沿边滑动的速度，箱子才堆得住。每子步只调用一次。
    if (!friction || p.invMass === 0) return;
    const fr = 0.16;
    const tvx = p.x - p.px;
    const tvy = p.y - p.py;
    const tdot = tvx * -ny + tvy * nx;
    p.px += -ny * tdot * fr;
    p.py += nx * tdot * fr;
  }

  /**
   * 质点之间的圆碰撞：只用来处理绳子、链条这类没有闭合轮廓的物体。
   *
   * ⚠️ 两个都有闭合轮廓的物体之间**必须跳过**这一步，只走多边形推出。
   * 否则质点半径（7~11px）会大于物体生成时的间隙（2~8px），
   * 场景一加载就被互相弹开——箱子金字塔当场炸成一排，布袋娃娃的四肢会飞掉。
   */
  solveParticlePairs() {
    const ps = this.particles;
    const solid = this.bodies.map((b) => b.outline.length >= 3);
    const cell = 26;
    const grid = new Map();
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      const key = ((p.x / cell) | 0) + ',' + ((p.y / cell) | 0);
      let arr = grid.get(key);
      if (!arr) grid.set(key, (arr = []));
      arr.push(i);
    }
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      const cxi = (p.x / cell) | 0;
      const cyi = (p.y / cell) | 0;
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          const arr = grid.get(cxi + ox + ',' + (cyi + oy));
          if (!arr) continue;
          for (const j of arr) {
            if (j <= i) continue;
            const q = ps[j];
            if (q.body === p.body && p.body !== -1) continue;
            // 两边都是闭合面体 -> 交给多边形推出处理，这里跳过
            if (p.body >= 0 && q.body >= 0 && solid[p.body] && solid[q.body]) continue;
            const wsum = p.invMass + q.invMass;
            if (wsum === 0) continue;
            let dx = q.x - p.x;
            let dy = q.y - p.y;
            const rr = p.r + q.r;
            const d2 = dx * dx + dy * dy;
            if (d2 >= rr * rr || d2 < 1e-9) continue;
            const d = Math.sqrt(d2);
            const push = ((rr - d) / d) * 0.5;
            dx *= push;
            dy *= push;
            const wa = p.invMass / wsum;
            const wb = q.invMass / wsum;
            p.x -= dx * 2 * wa;
            p.y -= dy * 2 * wa;
            q.x += dx * 2 * wb;
            q.y += dy * 2 * wb;
          }
        }
      }
    }
  }

  // 世界边界：地面 + 左右墙，地面带摩擦
  solveBounds(friction = false) {
    const { w, h } = this.bounds;
    for (const p of this.particles) {
      if (p.invMass === 0) continue;
      const r = p.r;
      if (p.x < r) p.x = r;
      if (p.x > w - r) p.x = w - r;
      if (p.y > h - r) {
        p.y = h - r;
        // 地面摩擦：把水平速度削掉一部分，物体才不会一直滑
        if (friction) {
          const vx = p.x - p.px;
          p.px += vx * 0.14;
        }
      }
      // 天花板：重力调到 0 时东西会一路飘出画面，加个顶盖免得跑丢
      if (p.y < r) p.y = r;
    }
  }

  /** 找离 (x,y) 最近、且在半径内的可动质点，用于鼠标抓取。 */
  pick(x, y, radius = 46) {
    let best = radius * radius;
    let idx = -1;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (p.invMass === 0) continue;
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < best) {
        best = d;
        idx = i;
      }
    }
    return idx;
  }

  /** 在一点炸一下：戳的手感来源。 */
  explode(x, y, radius = 150, power = 26) {
    for (const p of this.particles) {
      if (p.invMass === 0) continue;
      const dx = p.x - x;
      const dy = p.y - y;
      const d = Math.hypot(dx, dy);
      if (d > radius || d < 1e-6) continue;
      const f = (1 - d / radius) * power;
      p.px -= (dx / d) * f;
      p.py -= (dy / d) * f;
    }
  }
}
