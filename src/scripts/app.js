// 画布渲染 + 交互 + 参数面板。物理在 engine.js，场景在 scenes.js。

import { buildWorld, SCENES } from './scenes.js';

const canvas = document.getElementById('stage');
if (canvas) {
  const ctx = canvas.getContext('2d');
  const wrap = document.getElementById('stage-wrap');
  const hintEl = document.getElementById('hint');
  const statEl = document.getElementById('stat');

  const sliders = {
    stiffness: document.getElementById('s-stiffness'),
    damping: document.getElementById('s-damping'),
    gravity: document.getElementById('s-gravity'),
    pressure: document.getElementById('s-pressure'),
  };
  const readouts = {
    stiffness: document.getElementById('v-stiffness'),
    damping: document.getElementById('v-damping'),
    gravity: document.getElementById('v-gravity'),
    pressure: document.getElementById('v-pressure'),
  };

  let world = null;
  let scene = null;
  let sceneId = SCENES[0].id;
  let wire = false;
  let dpr = 1;
  const ripples = [];

  // ------------------------------------------------------------ 尺寸与重建

  function sizeOf() {
    const rect = wrap.getBoundingClientRect();
    return { w: Math.max(320, Math.round(rect.width)), h: Math.max(280, Math.round(rect.height)) };
  }

  function applyCanvasSize() {
    const { w, h } = sizeOf();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w, h };
  }

  function reset(keepParams = false) {
    const prev = world
      ? {
          stiffness: world.stiffness,
          damping: world.damping,
          gravity: world.gravity,
          pressure: world.pressure,
        }
      : null;
    const { w, h } = applyCanvasSize();
    const built = buildWorld(sceneId, w, h);
    world = built.world;
    scene = built.scene;
    if (keepParams && prev) Object.assign(world, prev);
    // 调试钩子：控制台里可以直接改参数、看质点状态
    window.__qpWorld = world;
    syncSlidersFromWorld();
    hintEl.textContent = scene.hint;
    ripples.length = 0;
  }

  function syncSlidersFromWorld() {
    sliders.stiffness.value = String(world.stiffness);
    sliders.damping.value = String(world.damping);
    sliders.gravity.value = String(world.gravity);
    sliders.pressure.value = String(world.pressure);
    updateReadouts();
  }

  function updateReadouts() {
    readouts.stiffness.textContent = Number(world.stiffness).toFixed(2);
    readouts.damping.textContent = Number(world.damping).toFixed(3);
    readouts.gravity.textContent = Math.round(world.gravity);
    readouts.pressure.textContent = Number(world.pressure).toFixed(2);
  }

  for (const [key, el] of Object.entries(sliders)) {
    el.addEventListener('input', () => {
      world[key] = Number(el.value);
      updateReadouts();
    });
  }

  // ------------------------------------------------------------ 交互

  function pointFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  canvas.addEventListener('pointerdown', (e) => {
    const { x, y } = pointFromEvent(e);
    const idx = world.pick(x, y, 52);
    if (idx >= 0) {
      world.grab = { p: idx, x, y };
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = 'grabbing';
    } else {
      // 空白处点一下 = 戳一炮
      world.explode(x, y, 170, 30);
      ripples.push({ x, y, t: 0 });
    }
    e.preventDefault();
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!world.grab) return;
    const { x, y } = pointFromEvent(e);
    world.grab.x = x;
    world.grab.y = y;
  });

  function release() {
    world.grab = null;
    canvas.style.cursor = 'grab';
  }
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('pointerleave', release);
  // 画布上不要触发页面滚动 / 双击缩放
  canvas.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

  document.querySelectorAll('[data-scene]').forEach((btn) => {
    btn.addEventListener('click', () => {
      sceneId = btn.dataset.scene;
      document.querySelectorAll('[data-scene]').forEach((b) => b.classList.toggle('on', b === btn));
      reset(false);
    });
  });

  document.getElementById('btn-reset').addEventListener('click', () => reset(true));
  const wireBtn = document.getElementById('btn-wire');
  wireBtn.addEventListener('click', () => {
    wire = !wire;
    wireBtn.classList.toggle('on', wire);
    wireBtn.textContent = wire ? '线框：开' : '线框：关';
  });

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => reset(true), 220);
  });

  // ------------------------------------------------------------ 渲染

  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  /** 软体轮廓画成经过各质点中点的光滑曲线，硬体直接连直线。 */
  function tracePath(body) {
    const o = body.outline;
    const ps = world.particles;
    ctx.beginPath();
    if (body.kind === 'rigid' || body.kind === 'static') {
      ctx.moveTo(ps[o[0]].x, ps[o[0]].y);
      for (let i = 1; i < o.length; i++) ctx.lineTo(ps[o[i]].x, ps[o[i]].y);
      ctx.closePath();
      return;
    }
    const n = o.length;
    const mid = (i, j) => ({ x: (ps[o[i]].x + ps[o[j]].x) / 2, y: (ps[o[i]].y + ps[o[j]].y) / 2 });
    let m = mid(n - 1, 0);
    ctx.moveTo(m.x, m.y);
    for (let i = 0; i < n; i++) {
      const next = mid(i, (i + 1) % n);
      ctx.quadraticCurveTo(ps[o[i]].x, ps[o[i]].y, next.x, next.y);
    }
    ctx.closePath();
  }

  function draw(w, h) {
    ctx.clearRect(0, 0, w, h);
    // 背景网格
    ctx.save();
    ctx.strokeStyle = 'rgba(120,160,255,0.055)';
    ctx.lineWidth = 1;
    const g = 34;
    ctx.beginPath();
    for (let x = 0; x < w; x += g) {
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, h);
    }
    for (let y = 0; y < h; y += g) {
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(w, y + 0.5);
    }
    ctx.stroke();
    ctx.restore();

    // 戳出来的涟漪
    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i];
      r.t += 0.055;
      if (r.t >= 1) {
        ripples.splice(i, 1);
        continue;
      }
      ctx.beginPath();
      ctx.arc(r.x, r.y, 30 + r.t * 150, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(120,225,255,${(1 - r.t) * 0.5})`;
      ctx.lineWidth = 2.5 * (1 - r.t);
      ctx.stroke();
    }

    const ps = world.particles;

    // 绳 / 链
    for (const b of world.bodies) {
      if (b.kind !== 'rope') continue;
      ctx.beginPath();
      const ids = b.particles;
      ctx.moveTo(ps[ids[0]].x, ps[ids[0]].y);
      for (let i = 1; i < ids.length; i++) ctx.lineTo(ps[ids[i]].x, ps[ids[i]].y);
      ctx.strokeStyle = hexA(b.color, 0.85);
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
      for (const i of ids) {
        ctx.beginPath();
        ctx.arc(ps[i].x, ps[i].y, 3.2, 0, Math.PI * 2);
        ctx.fillStyle = hexA(b.color, 0.95);
        ctx.fill();
      }
    }

    // 面体
    for (const b of world.bodies) {
      if (b.outline.length < 3) continue;
      tracePath(b);
      if (b.static) {
        ctx.fillStyle = 'rgba(90,110,160,0.28)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(140,170,230,0.55)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        continue;
      }
      ctx.save();
      ctx.shadowColor = hexA(b.color, 0.55);
      ctx.shadowBlur = 22;
      ctx.fillStyle = hexA(b.color, b.kind === 'rigid' ? 0.2 : 0.24);
      ctx.fill();
      ctx.strokeStyle = hexA(b.color, 0.95);
      ctx.lineWidth = b.kind === 'rigid' ? 2 : 2.6;
      ctx.stroke();
      ctx.restore();
      // 高光，让果冻看着有体积
      if (b.kind === 'soft') {
        tracePath(b);
        ctx.save();
        ctx.clip();
        const bb = b.aabb;
        const grd = ctx.createLinearGradient(bb.x0, bb.y0, bb.x0, bb.y1);
        grd.addColorStop(0, hexA(b.color, 0.34));
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grd;
        ctx.fillRect(bb.x0, bb.y0, bb.x1 - bb.x0, bb.y1 - bb.y0);
        ctx.restore();
      }
    }

    // 线框模式：把弹簧和质点全画出来，看清它其实是一堆点和约束
    if (wire) {
      ctx.strokeStyle = 'rgba(180,220,255,0.28)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const s of world.springs) {
        ctx.moveTo(ps[s.a].x, ps[s.a].y);
        ctx.lineTo(ps[s.b].x, ps[s.b].y);
      }
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      for (const p of ps) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.invMass === 0 ? 3.6 : 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      // 常态下只点出轮廓质点，暗示它是粒子系统
      ctx.fillStyle = 'rgba(255,255,255,0.62)';
      for (const b of world.bodies) {
        if (b.static) continue;
        for (const i of b.outline) {
          ctx.beginPath();
          ctx.arc(ps[i].x, ps[i].y, 1.9, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // 抓取指示
    if (world.grab) {
      const p = ps[world.grab.p];
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(world.grab.x, world.grab.y);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  // ------------------------------------------------------------ 主循环

  let last = performance.now();
  let acc = 0;
  let fpsT = 0;
  let fpsN = 0;
  let fps = 60;

  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.25) dt = 0.25;
    acc += dt;
    const fixed = 1 / 60;
    let steps = 0;
    while (acc >= fixed && steps < 4) {
      world.step(fixed);
      acc -= fixed;
      steps++;
    }
    if (acc > fixed) acc = 0;

    const { w, h } = sizeOf();
    draw(w, h);

    fpsT += dt;
    fpsN++;
    if (fpsT >= 0.5) {
      fps = Math.round(fpsN / fpsT);
      fpsT = 0;
      fpsN = 0;
      statEl.textContent = `${world.particles.length} 质点 · ${world.springs.length} 约束 · ${fps} FPS`;
    }
    requestAnimationFrame(frame);
  }

  reset(false);
  document.querySelector('[data-scene]')?.classList.add('on');
  requestAnimationFrame(frame);
}
