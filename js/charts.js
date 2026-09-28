// Minimal dependency-free SVG charts with hover tooltips.
(function (global) {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";

  function el(tag, attrs, parent) {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function scale(d0, d1, r0, r1) {
    const f = (v) => r0 + ((v - d0) / (d1 - d0 || 1)) * (r1 - r0);
    f.invert = (p) => d0 + ((p - r0) / (r1 - r0 || 1)) * (d1 - d0);
    return f;
  }
  function niceTicks(min, max, count = 5) {
    const span = max - min || 1;
    const step0 = Math.pow(10, Math.floor(Math.log10(span / count)));
    const err = span / count / step0;
    const step = step0 * (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1);
    const ticks = [];
    for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) ticks.push(+v.toFixed(10));
    return ticks;
  }
  const cssVar = (name) => `var(${name})`;

  function frame(container, opts) {
    container.innerHTML = "";
    container.classList.add("chart");
    const width = Math.max(280, container.clientWidth);
    const height = opts.height || Math.round(Math.min(380, Math.max(240, width * 0.58)));
    const m = Object.assign({ top: 14, right: 18, bottom: 42, left: 52 }, opts.margin);
    const svg = el("svg", { viewBox: `0 0 ${width} ${height}`, width, height, role: "img", "aria-label": opts.ariaLabel || "" }, container);
    const tip = document.createElement("div");
    tip.className = "tooltip";
    container.appendChild(tip);
    return { svg, tip, width, height, m, iw: width - m.left - m.right, ih: height - m.top - m.bottom };
  }

  function axes(f, xs, ys, o) {
    const g = el("g", { class: "axes" }, f.svg);
    const xt = o.x.ticks || niceTicks(xs.domain[0], xs.domain[1], Math.max(3, Math.floor(f.iw / 70)));
    const yt = o.y.ticks || niceTicks(ys.domain[0], ys.domain[1], Math.max(3, Math.floor(f.ih / 50)));
    for (const t of yt) {
      const y = ys(t);
      el("line", { x1: f.m.left, x2: f.m.left + f.iw, y1: y, y2: y, class: "grid" }, g);
      el("text", { x: f.m.left - 8, y: y + 4, "text-anchor": "end", class: "tick" }, g).textContent = (o.y.format || String)(t);
    }
    for (const t of xt) {
      const x = xs(t);
      el("text", { x, y: f.m.top + f.ih + 18, "text-anchor": "middle", class: "tick" }, g).textContent = (o.x.format || String)(t);
    }
    el("line", { x1: f.m.left, x2: f.m.left + f.iw, y1: f.m.top + f.ih, y2: f.m.top + f.ih, class: "baseline" }, g);
    el("text", { x: f.m.left + f.iw / 2, y: f.height - 6, "text-anchor": "middle", class: "axis-label" }, g).textContent = o.x.label;
    el("text", { x: 12, y: f.m.top + f.ih / 2, "text-anchor": "middle", class: "axis-label", transform: `rotate(-90 12 ${f.m.top + f.ih / 2})` }, g).textContent = o.y.label;
  }

  function showTip(f, html, px, py) {
    f.tip.innerHTML = html;
    f.tip.style.display = "block";
    const tw = f.tip.offsetWidth, th = f.tip.offsetHeight;
    let left = px + 14, top = py - th - 10;
    if (left + tw > f.width) left = px - tw - 14;
    if (top < 0) top = py + 14;
    f.tip.style.left = Math.max(0, left) + "px";
    f.tip.style.top = top + "px";
  }
  const hideTip = (f) => { f.tip.style.display = "none"; };

  const pathD = (pts, xs, ys) => pts.map((p, i) => `${i ? "L" : "M"}${xs(p.x).toFixed(1)},${ys(p.y).toFixed(1)}`).join("");

  /**
   * Scatter + lines + optional band.
   * opts: { x:{label,domain,format}, y:{...}, points:[{x,y,...}], pointColor, pointTip(p),
   *         lines:[{points,color,width,opacity,label,hover}], band:{points:[{x,lo,hi}],color},
   *         diagonal:boolean, jitter:number, lineTip(x, values) }
   */
  function plot(container, o) {
    const f = frame(container, o);
    const xs = scale(o.x.domain[0], o.x.domain[1], f.m.left, f.m.left + f.iw);
    const ys = scale(o.y.domain[0], o.y.domain[1], f.m.top + f.ih, f.m.top);
    xs.domain = o.x.domain; ys.domain = o.y.domain;
    axes(f, xs, ys, o);
    const clipId = "clip" + Math.random().toString(36).slice(2);
    el("rect", { x: f.m.left, y: f.m.top, width: f.iw, height: f.ih }, el("clipPath", { id: clipId }, el("defs", {}, f.svg)));
    const plotG = el("g", { "clip-path": `url(#${clipId})` }, f.svg);

    if (o.band) {
      const b = o.band.points;
      const d = b.map((p, i) => `${i ? "L" : "M"}${xs(p.x)},${ys(p.hi)}`).join("") + b.slice().reverse().map((p) => `L${xs(p.x)},${ys(p.lo)}`).join("") + "Z";
      el("path", { d, fill: o.band.color, opacity: 0.16 }, plotG);
    }
    if (o.diagonal) {
      const lo = Math.max(o.x.domain[0], o.y.domain[0]), hi = Math.min(o.x.domain[1], o.y.domain[1]);
      el("line", { x1: xs(lo), y1: ys(lo), x2: xs(hi), y2: ys(hi), class: "ref-line" }, plotG);
    }
    const jit = o.jitter || 0;
    const rand = global.Pipeline ? global.Pipeline.util.mulberry32(3) : Math.random;
    const drawn = (o.points || []).map((p) => {
      const cx = xs(p.x + (jit ? (rand() - 0.5) * jit : 0)), cy = ys(p.y);
      el("circle", { cx, cy, r: o.pointRadius || 3.2, fill: p.color || o.pointColor, "fill-opacity": o.pointOpacity ?? 0.45, stroke: "var(--surface)", "stroke-width": 0.8 }, plotG);
      return { p, cx, cy };
    });
    for (const ln of o.lines || []) {
      el("path", { d: pathD(ln.points, xs, ys), fill: "none", stroke: ln.color, "stroke-width": ln.width || 2, "stroke-opacity": ln.opacity ?? 1, "stroke-linejoin": "round", "stroke-linecap": "round", "stroke-dasharray": ln.dash || "" }, plotG);
    }
    // Direct labels at the right end of labelled lines.
    for (const ln of (o.lines || []).filter((l) => l.label)) {
      // Label at a chosen x (e.g. a peak, where lines are well apart) or at the right end.
      const at = ln.labelX != null ? ln.points.reduce((a, b) => (Math.abs(b.x - ln.labelX) < Math.abs(a.x - ln.labelX) ? b : a)) : ln.points[ln.points.length - 1];
      const t = ln.labelX != null
        ? el("text", { x: xs(at.x), y: ys(at.y) + (ln.labelBelow ? 18 : -9), "text-anchor": "middle", class: "direct-label" }, f.svg)
        : el("text", { x: Math.min(xs(at.x), f.m.left + f.iw) - 4, y: ys(at.y) - 8, "text-anchor": "end", class: "direct-label" }, f.svg);
      t.textContent = ln.label;
    }

    // Hover layer
    const hoverLines = (o.lines || []).filter((l) => l.hover);
    const cross = el("line", { y1: f.m.top, y2: f.m.top + f.ih, class: "crosshair", style: "display:none" }, f.svg);
    const dots = hoverLines.map((l) => el("circle", { r: 4.5, fill: l.color, stroke: "var(--surface)", "stroke-width": 2, style: "display:none" }, f.svg));
    const hit = el("rect", { x: f.m.left, y: f.m.top, width: f.iw, height: f.ih, fill: "transparent" }, f.svg);
    const ring = el("circle", { r: 6, fill: "none", stroke: "var(--text)", "stroke-width": 1.5, style: "display:none" }, f.svg);
    hit.addEventListener("pointermove", (ev) => {
      const rect = f.svg.getBoundingClientRect();
      const px = ((ev.clientX - rect.left) / rect.width) * f.width;
      const py = ((ev.clientY - rect.top) / rect.height) * f.height;
      let best = null, bd = 18 * 18;
      for (const d of drawn) {
        const dd = (d.cx - px) ** 2 + (d.cy - py) ** 2;
        if (dd < bd) { bd = dd; best = d; }
      }
      if (best && o.pointTip) {
        cross.style.display = "none"; dots.forEach((d) => (d.style.display = "none"));
        ring.setAttribute("cx", best.cx); ring.setAttribute("cy", best.cy); ring.style.display = "";
        showTip(f, o.pointTip(best.p), best.cx, best.cy);
        return;
      }
      ring.style.display = "none";
      if (!hoverLines.length) return hideTip(f);
      const xv = xs.invert(px);
      const pts = hoverLines.map((l) => l.points.reduce((a, b) => (Math.abs(b.x - xv) < Math.abs(a.x - xv) ? b : a)));
      const sx = xs(pts[0].x);
      cross.setAttribute("x1", sx); cross.setAttribute("x2", sx); cross.style.display = "";
      pts.forEach((p, i) => { dots[i].setAttribute("cx", xs(p.x)); dots[i].setAttribute("cy", ys(p.y)); dots[i].style.display = ""; });
      showTip(f, o.lineTip(pts[0].x, pts, hoverLines), sx, Math.min(...pts.map((p) => ys(p.y))));
    });
    hit.addEventListener("pointerleave", () => { hideTip(f); ring.style.display = "none"; cross.style.display = "none"; dots.forEach((d) => (d.style.display = "none")); });
    return f;
  }

  /** Horizontal bars with error whiskers. items: [{label, value, lo, hi, color, tip}] */
  function bars(container, items, o = {}) {
    const rowH = 34;
    const f = frame(container, Object.assign({ height: items.length * rowH + 50, margin: { left: 120, right: 20, top: 10, bottom: 36 } }, o));
    const ext = [Math.min(0, ...items.map((d) => d.lo)), Math.max(0, ...items.map((d) => d.hi))];
    const pad = (ext[1] - ext[0]) * 0.08;
    const xs = scale(ext[0] - pad, ext[1] + pad, f.m.left, f.m.left + f.iw);
    const ticks = niceTicks(ext[0] - pad, ext[1] + pad, Math.max(3, Math.floor(f.iw / 80)));
    for (const t of ticks) {
      el("line", { x1: xs(t), x2: xs(t), y1: f.m.top, y2: f.m.top + f.ih, class: t === 0 ? "baseline" : "grid" }, f.svg);
      el("text", { x: xs(t), y: f.m.top + f.ih + 16, "text-anchor": "middle", class: "tick" }, f.svg).textContent = (o.format || String)(t);
    }
    el("text", { x: f.m.left + f.iw / 2, y: f.height - 4, "text-anchor": "middle", class: "axis-label" }, f.svg).textContent = o.xLabel || "";
    items.forEach((d, i) => {
      const cy = f.m.top + i * rowH + rowH / 2;
      const x0 = xs(0), x1 = xs(d.value);
      const g = el("g", { class: "bar-row" }, f.svg);
      el("text", { x: f.m.left - 10, y: cy + 4, "text-anchor": "end", class: "tick strong" }, g).textContent = d.label;
      el("rect", { x: Math.min(x0, x1), y: cy - 8, width: Math.max(2, Math.abs(x1 - x0)), height: 16, rx: 4, fill: d.color }, g);
      el("line", { x1: xs(d.lo), x2: xs(d.hi), y1: cy, y2: cy, class: "whisker" }, g);
      el("line", { x1: xs(d.lo), x2: xs(d.lo), y1: cy - 5, y2: cy + 5, class: "whisker" }, g);
      el("line", { x1: xs(d.hi), x2: xs(d.hi), y1: cy - 5, y2: cy + 5, class: "whisker" }, g);
      const hit = el("rect", { x: f.m.left, y: cy - rowH / 2, width: f.iw, height: rowH, fill: "transparent" }, g);
      hit.addEventListener("pointermove", () => showTip(f, d.tip, Math.max(x0, x1), cy));
      hit.addEventListener("pointerleave", () => hideTip(f));
    });
    return f;
  }

  /** Histogram. */
  function histogram(container, values, o) {
    const bins = o.bins || 24;
    const min = Math.min(...values), max = Math.max(...values);
    const w = (max - min) / bins || 1;
    const counts = new Array(bins).fill(0);
    for (const v of values) counts[Math.min(bins - 1, Math.floor((v - min) / w))]++;
    const f = frame(container, Object.assign({ height: 170, margin: { top: 10, right: 10, bottom: 36, left: 40 } }, o));
    const xs = scale(min, max, f.m.left, f.m.left + f.iw);
    const ys = scale(0, Math.max(...counts), f.m.top + f.ih, f.m.top);
    xs.domain = [min, max]; ys.domain = [0, Math.max(...counts)];
    axes(f, xs, ys, { x: { label: o.label, format: o.format }, y: { label: "rows", ticks: niceTicks(0, Math.max(...counts), 3) } });
    counts.forEach((c, i) => {
      const x = xs(min + i * w) + 1, bw = Math.max(1, xs(min + (i + 1) * w) - xs(min + i * w) - 2);
      const r = el("rect", { x, y: ys(c), width: bw, height: f.m.top + f.ih - ys(c), rx: Math.min(3, bw / 2), fill: o.color }, f.svg);
      r.addEventListener("pointermove", () => showTip(f, `<b>${(o.format || String)(min + i * w)} – ${(o.format || String)(min + (i + 1) * w)}</b><br>${c} rows`, x + bw / 2, ys(c)));
      r.addEventListener("pointerleave", () => hideTip(f));
    });
    return f;
  }

  global.Charts = { plot, bars, histogram, niceTicks };
})(window);
