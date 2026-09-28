// Canvas particle layer: each dot is a bundle of rows travelling down the pipe between stations.
(function (global) {
  "use strict";
  let root, canvas, ctx, dots = [], current = -1, swirling = false, raf = 0, speed = 1;
  const DOTS = 90;

  const cssColor = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888";
  const now = () => performance.now();

  function stations() {
    const r = root.getBoundingClientRect();
    return [...root.querySelectorAll(".station span")].map((s) => {
      const b = s.getBoundingClientRect();
      return { x: b.left - r.left + b.width / 2, y: b.top - r.top + b.height / 2, r: b.width / 2 };
    });
  }

  function init(pipelineEl, canvasEl) {
    root = pipelineEl; canvas = canvasEl; ctx = canvas.getContext("2d");
    if (!raf) raf = requestAnimationFrame(tick);
  }
  function setSpeed(s) { speed = s; }
  function reset() { dots = []; current = -1; swirling = false; }

  function spawn(stageIdx = 0) {
    reset();
    current = stageIdx;
    const st = stations()[stageIdx];
    for (let i = 0; i < DOTS; i++) {
      dots.push({
        x: st.x + (Math.random() - 0.5) * 50, y: -20 - Math.random() * 120,
        ang: Math.random() * Math.PI * 2, rad: st.r + 6 + Math.random() * 12,
        color: "--s1", alpha: 1, state: "alive", t0: now() + i * 9 * Math.max(speed, 0.05),
      });
    }
    if (!speed) snap();
  }

  function moveTo(stageIdx) {
    current = stageIdx;
    const alive = dots.filter((d) => d.state === "alive");
    alive.forEach((d, i) => { d.t0 = now() + i * 11 * speed; });
    if (!speed) snap();
  }

  function reject(groups) {
    // groups: [{count, color}] ; count is number of dots to eject with that colour
    const alive = dots.filter((d) => d.state === "alive");
    let k = 0;
    for (const g of groups) {
      for (let i = 0; i < g.count && k < alive.length; i++, k++) {
        const d = alive[Math.floor((k * 7919) % alive.length)];
        if (d.state !== "alive") { i--; continue; }
        d.color = g.color; d.state = "flag"; d.t0 = now() + k * 60 * speed;
      }
    }
    setTimeout(() => dots.forEach((d) => { if (d.state === "flag") { d.state = "reject"; d.vx = -0.6 - Math.random(); d.vy = 0.4 + Math.random() * 0.8; } }), 900 * speed);
  }

  function recolor(color) {
    dots.filter((d) => d.state === "alive").forEach((d, i) => { d.pending = color; d.tc = now() + i * 12 * speed; });
  }
  function swirl(on) { swirling = on; }
  function exit() {
    dots.filter((d) => d.state === "alive").forEach((d, i) => { d.state = "exit"; d.t0 = now() + i * 10 * speed; });
  }
  function snap() {
    const st = stations()[current];
    if (!st) return;
    for (const d of dots) if (d.state === "alive") { d.x = st.x + Math.cos(d.ang) * d.rad; d.y = st.y + Math.sin(d.ang) * d.rad; d.t0 = 0; }
  }

  function tick() {
    raf = requestAnimationFrame(tick);
    if (!root) return;
    const dpr = window.devicePixelRatio || 1;
    const w = root.clientWidth, h = root.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      canvas.style.width = w + "px"; canvas.style.height = h + "px";
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const sts = stations();
    if (!sts.length) return;
    const colors = { "--s1": cssColor("--s1"), "--s2": cssColor("--s2"), "--s3": cssColor("--s3"), "--c-missing": cssColor("--c-missing"), "--c-dup": cssColor("--c-dup"), "--c-invalid": cssColor("--c-invalid") };
    const border = cssColor("--border");

    // The pipe itself: segments between stations (never over the icons), filled up to the active station.
    const last = sts[sts.length - 1];
    ctx.lineCap = "round"; ctx.lineWidth = 6;
    const seg = (a, b, y2) => { ctx.beginPath(); ctx.moveTo(a.x, a.y + a.r + 6); ctx.lineTo(a.x, y2 ?? b.y - b.r - 6); ctx.stroke(); };
    ctx.strokeStyle = border;
    for (let i = 0; i < sts.length - 1; i++) seg(sts[i], sts[i + 1]);
    seg(last, null, last.y + 70);
    ctx.globalAlpha = 0.45; ctx.strokeStyle = colors["--s1"];
    for (let i = 0; i < Math.min(current, sts.length - 1); i++) seg(sts[i], sts[i + 1]);
    ctx.globalAlpha = 1;

    const t = now();
    const ease = speed ? 0.09 : 1;
    for (const d of dots) {
      if (d.state === "dead") continue;
      if (d.pending && t >= d.tc) { d.color = d.pending; d.pending = null; }
      if (d.state === "alive" || d.state === "flag") {
        const st = sts[current];
        if (swirling && d.state === "alive") d.ang += 0.045;
        if (t >= d.t0) {
          const tx = st.x + Math.cos(d.ang) * d.rad, ty = st.y + Math.sin(d.ang) * d.rad;
          // Travel down the pipe first (x snaps to the lane), then settle into orbit.
          const far = Math.abs(ty - d.y) > 40;
          d.x += ((far ? st.x + Math.cos(d.ang) * 4 : tx) - d.x) * ease * 1.3;
          d.y += (ty - d.y) * ease;
        }
      } else if (d.state === "reject") {
        d.x += d.vx * 2.2; d.y += d.vy * 2.2; d.vy += 0.05;
        d.alpha -= 0.018;
        if (d.alpha <= 0) d.state = "dead";
      } else if (d.state === "exit" && t >= d.t0) {
        d.x += (last.x - d.x) * 0.1;
        d.y += 5 + Math.random() * 2;
        if (d.y > last.y + 40) d.alpha -= 0.05;
        if (d.alpha <= 0) d.state = "dead";
      }
      ctx.globalAlpha = Math.max(0, d.alpha);
      ctx.fillStyle = colors[d.color] || d.color;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.state === "flag" ? 4.2 : 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  global.Flow = { init, spawn, moveTo, reject, recolor, swirl, exit, reset, setSpeed };
})(window);
