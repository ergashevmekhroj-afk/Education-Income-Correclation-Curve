(function () {
  "use strict";
  const P = window.Pipeline;
  const $ = (s, r = document) => r.querySelector(s);
  const stageEl = (name) => $(`.stage[data-stage="${name}"]`);
  const fmt$ = (v) => "$" + v.toFixed(2);
  const fmtPct = (v, d = 1) => (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(d) + "%";
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const NICE = { educ: "Education (yrs)", exper: "Experience (yrs)", expersq: "Experience²", tenure: "Tenure (yrs)", female: "Female", married: "Married", intercept: "Intercept" };

  let source = { name: "wage1.csv", text: window.SAMPLE_CSV };
  let speed = 1, running = false, state = null, autoScroll = false;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms * speed));

  // ---------- input ----------
  const fileInput = $("#file"), dz = $("#dropzone"), chip = $("#fileChip");
  function setFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      source = { name: file.name, text: String(reader.result) };
      const rows = source.text.trim().split(/\r?\n/).length - 1;
      chip.classList.remove("error");
      chip.innerHTML = `Loaded <b>${esc(file.name)}</b> · ${rows.toLocaleString()} rows`;
      autoScroll = true;
      run();
    };
    reader.readAsText(file);
  }
  fileInput.addEventListener("change", () => setFile(fileInput.files[0]));
  dz.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); } });
  ["dragenter", "dragover"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("over"); }));
  dz.addEventListener("drop", (e) => setFile(e.dataTransfer.files[0]));
  $("#speed").addEventListener("change", (e) => { speed = +e.target.value; Flow.setSpeed(speed); });
  $("#run").addEventListener("click", () => { autoScroll = true; run(); });

  // ---------- stage helpers ----------
  function setStage(name, cls, status, progress) {
    const el = stageEl(name);
    el.classList.remove("running", "done", "error");
    if (cls) el.classList.add(cls);
    if (status != null) $(".status", el).innerHTML = status;
    if (progress != null) $(".progress i", el).style.width = progress + "%";
    return $(".details", el);
  }
  function focusStage(name) {
    if (!speed || !autoScroll) return;
    const el = stageEl(name);
    const r = el.getBoundingClientRect();
    if (r.top < 60 || r.top > window.innerHeight * 0.55) window.scrollTo({ top: window.scrollY + r.top - 90, behavior: "smooth" });
  }
  function resetStages() {
    const defaults = { upload: "Waiting for a file", validate: "Checking schema", clean: "Missing values · duplicates · invalid values", transform: "Feature creation", train: "Training", predict: "wage_forecast" };
    for (const [k, v] of Object.entries(defaults)) { setStage(k, null, v, 0).innerHTML = ""; }
  }
  function table(cols, rows, opts = {}) {
    const head = cols.map((c) => `<th class="${opts.newCols && opts.newCols.includes(c.key) ? "new col-in" : ""}">${esc(c.label)}</th>`).join("");
    const body = rows.map((r, i) => `<tr class="appear ${r._cls || ""}" style="animation-delay:${speed ? i * 90 : 0}ms">` + cols.map((c) => {
      const v = r[c.key];
      const isNew = opts.newCols && opts.newCols.includes(c.key);
      return `<td class="${isNew ? "new col-in" : ""} ${c.cls ? c.cls(v, r) : ""}" ${isNew && speed ? `style="animation-delay:${400 + i * 60}ms"` : ""}>${c.f ? c.f(v, r) : v == null ? "<span class='muted'>∅</span>" : esc(v)}</td>`;
    }).join("") + "</tr>").join("");
    return `<div class="table-wrap"><table class="data"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  }
  const n2 = (v) => (v == null ? "<span class='muted'>∅</span>" : typeof v === "number" ? (Number.isInteger(v) ? v : v.toFixed(2)) : esc(v));

  // ---------- run ----------
  async function run() {
    if (running) return;
    running = true;
    $("#run").disabled = true;
    $("#results").hidden = true;
    resetStages();
    Flow.setSpeed(speed);
    try {
      const text = $("#messy").checked ? P.injectMess(source.text) : source.text;
      const name = $("#messy").checked ? source.name.replace(/\.csv$/i, "") + "_messy.csv" : source.name;

      // 1. Upload
      focusStage("upload");
      let d = setStage("upload", "running", "Reading file…", 20);
      Flow.spawn(0);
      await wait(500);
      const up = P.upload(text, name);
      const previewCols = ["wage", "educ", "exper", "tenure", "female", "married"].filter((c) => up.header.includes(c));
      const shownCols = previewCols.length >= 3 ? previewCols : up.header.slice(0, 6);
      d.innerHTML = `<div class="meta">
          <div><b>${esc(up.name)}</b><span>file</span></div>
          <div><b>${(up.bytes / 1024).toFixed(1)} KB</b><span>size</span></div>
          <div><b class="num">${up.summary.rows.toLocaleString()}</b><span>rows</span></div>
          <div><b class="num">${up.summary.columns}</b><span>columns</span></div></div>
        <p class="mini-title">First rows (${shownCols.length} of ${up.header.length} columns shown)</p>` +
        table(shownCols.map((c) => ({ key: c, label: c, f: n2 })), up.records.slice(0, 6));
      setStage("upload", "running", "Parsing rows…", 70);
      await wait(1100);
      setStage("upload", "done", `${esc(up.name)} · ${up.summary.rows.toLocaleString()} rows × ${up.summary.columns} columns`, 100);

      // 2. Validation
      focusStage("validate");
      Flow.moveTo(1);
      d = setStage("validate", "running", "Checking schema…", 10);
      await wait(700);
      const val = P.validate(up);
      d.innerHTML = `<ul class="checklist"></ul>`;
      const ul = $(".checklist", d);
      for (const [i, c] of val.checks.entries()) {
        const kind = c.info ? "info" : c.ok ? "ok" : c.warn ? "warn" : "bad";
        ul.insertAdjacentHTML("beforeend", `<li class="appear"><span class="ic ${kind}">${{ ok: "✓", warn: "!", bad: "✗", info: "i" }[kind]}</span><span>${esc(c.label)}</span></li>`);
        setStage("validate", "running", null, 10 + (80 * (i + 1)) / val.checks.length);
        await wait(260);
      }
      const used = val.schema.filter((s) => s.role !== "ignored");
      d.insertAdjacentHTML("beforeend", `<p class="mini-title">Schema of model columns${val.schema.length > used.length ? ` · ${val.schema.length - used.length} other columns ignored` : ""}</p>` +
        table([
          { key: "column", label: "column" },
          { key: "role", label: "role" },
          { key: "type", label: "type", cls: (v) => (v === "numeric" ? "ok" : "bad") },
          { key: "nulls", label: "missing", cls: (v) => (v ? "warn" : "") },
          { key: "outOfRange", label: "out of range", cls: (v) => (v ? "warn" : "") },
          { key: "min", label: "min", f: n2 },
          { key: "max", label: "max", f: n2 },
        ], used));
      if (val.fatal) {
        setStage("validate", "error", "Schema check failed. This file can't be used for the wage model.", 100);
        chip.classList.add("error");
        Flow.reject([{ count: 90, color: "--c-invalid" }]);
        return;
      }
      await wait(900);
      const issues = sum(used.map((s) => s.nulls + s.outOfRange));
      setStage("validate", "done", `Schema OK · ✓ ${val.rows.toLocaleString()} rows${issues ? ` · ${issues} issue(s) flagged for cleaning` : ""}`, 100);

      // 3. Cleaning
      focusStage("clean");
      Flow.moveTo(2);
      d = setStage("clean", "running", "Scanning rows…", 5);
      await wait(700);
      const cl = P.clean(up, val);
      d.innerHTML = `<div class="keys">
          <span><i style="background:color-mix(in srgb,var(--s1) 55%,var(--surface-2))"></i>kept</span>
          <span><i style="background:var(--c-missing)"></i>missing required value · <b class="num">${cl.reasons.missingRequired}</b></span>
          <span><i style="background:var(--c-dup)"></i>duplicate · <b class="num">${cl.reasons.duplicate}</b></span>
          <span><i style="background:var(--c-invalid)"></i>invalid / out of range · <b class="num">${cl.reasons.invalid + cl.reasons.nonNumeric}</b></span>
        </div>
        <div class="waffle" role="img" aria-label="One square per row"></div>
        <p class="clean-note muted"></p>`;
      const waffle = $(".waffle", d);
      waffle.innerHTML = "<i></i>".repeat(up.records.length);
      const cells = waffle.children;
      // Sweep a scan line through the rows, flagging the bad ones as we go.
      const steps = 24;
      const per = Math.ceil(cells.length / steps);
      for (let s = 0; s < steps; s++) {
        for (let i = s * per; i < Math.min(cells.length, (s + 1) * per); i++) {
          if (cl.status[i] !== "kept") cells[i].classList.add(cl.status[i]);
        }
        setStage("clean", "running", `Scanning rows… ${Math.min(cells.length, (s + 1) * per).toLocaleString()} / ${cells.length.toLocaleString()}`, 5 + (60 * (s + 1)) / steps);
        if (speed) await wait(45);
      }
      const total = up.records.length;
      const ejectDots = (n) => Math.round((n / total) * 90) || (n ? 1 : 0);
      Flow.reject([
        { count: ejectDots(cl.reasons.missingRequired), color: "--c-missing" },
        { count: ejectDots(cl.reasons.duplicate), color: "--c-dup" },
        { count: ejectDots(cl.reasons.invalid + cl.reasons.nonNumeric), color: "--c-invalid" },
      ]);
      await wait(900);
      [...cells].forEach((c, i) => { if (cl.status[i] !== "kept") c.classList.add("gone"); });
      await wait(700);
      waffle.classList.add("compact");
      const imp = Object.entries(cl.imputed).map(([c, v]) => `${v.count} missing <code>${esc(c)}</code> value(s) filled with the median (${v.value})`);
      $(".clean-note", d).innerHTML = cl.removed
        ? `Removed <b>${cl.removed}</b> row(s); <b>${cl.records.length.toLocaleString()}</b> clean rows continue.${imp.length ? " " + imp.join("; ") + "." : ""}`
        : `No problems found: all <b>${cl.records.length.toLocaleString()}</b> rows are complete, unique and in range.${imp.length ? " " + imp.join("; ") + "." : ""} Tick “Add messy rows” to see cleaning in action.`;
      setStage("clean", "done", `${cl.records.length.toLocaleString()} clean rows · ${cl.removed} removed${imp.length ? ` · ${sum(Object.values(cl.imputed).map((v) => v.count))} imputed` : ""}`, 100);

      // 4. Transform
      focusStage("transform");
      Flow.moveTo(3);
      d = setStage("transform", "running", "Creating features…", 15);
      await wait(700);
      const tr = P.transform(cl, val);
      Flow.recolor("--s3");
      const newCols = ["lwage", "expersq", "educ_level"];
      const baseCols = ["wage", "educ", "exper"].concat(val.optionalFound.filter((c) => c === "tenure"));
      d.innerHTML = `<ul class="checklist">${tr.created.map((c) => `<li class="appear"><span class="ic ok">+</span><span><code>${c.name} = ${esc(c.formula)}</code> · ${esc(c.why)}</span></li>`).join("")}</ul>` +
        table(baseCols.concat(newCols).map((c) => ({ key: c, label: c, f: (v) => (c === "educ_level" ? esc(v) : n2(v)) })), [0, 0.2, 0.4, 0.6, 0.8].map((q) => tr.rows.slice().sort((a, z) => a.educ - z.educ || a.exper - z.exper)[Math.floor(q * tr.rows.length) + 3]), { newCols }) +
        `<div class="two" style="margin-top:12px">
           <div><p class="mini-title">wage: skewness ${tr.skew.wage.toFixed(2)} (long right tail)</p><div class="h-wage"></div></div>
           <div><p class="mini-title">ln(wage): skewness ${tr.skew.lwage.toFixed(2)} (close to symmetric)</p><div class="h-lwage"></div></div>
         </div>`;
      setStage("transform", "running", null, 60);
      Charts.histogram($(".h-wage", d), tr.rows.map((r) => r.wage), { label: "hourly wage ($)", color: "var(--s1)", format: (v) => "$" + Math.round(v) });
      Charts.histogram($(".h-lwage", d), tr.rows.map((r) => r.lwage), { label: "ln(wage)", color: "var(--s3)", format: (v) => v.toFixed(1) });
      await wait(1400);
      setStage("transform", "done", `${tr.features.length} model features: ${tr.features.map((f) => `<code>${f}</code>`).join(" ")}`, 100);

      // 5. Train
      focusStage("train");
      Flow.moveTo(4);
      await wait(500);
      Flow.swirl(true);
      d = setStage("train", "running", "Splitting train / test…", 10);
      const tm = P.train(tr);
      d.innerHTML = `<p class="mini-title">Random 80 / 20 split (seed 42)</p>
        <div class="split"><div class="tr" style="flex-grow:1">train</div><div class="te" style="flex-grow:0">test</div></div>
        <p class="mini-title">Gradient descent: mean squared error of ln(wage) per epoch</p><div class="loss"></div>
        <div class="coef"></div>`;
      await wait(350);
      const split = $(".split", d);
      split.children[0].style.flexGrow = tm.split.train; split.children[0].textContent = `train · ${tm.split.train} rows`;
      split.children[1].style.flexGrow = tm.split.test; split.children[1].textContent = `test · ${tm.split.test}`;
      await wait(600);
      setStage("train", "running", "Training… gradient descent", 30);
      const loss = tm.gd.loss.map((y, x) => ({ x, y }));
      const lossShown = loss.slice(0, 201); // converged well before 200; later epochs only confirm it
      const lossBox = $(".loss", d);
      const frames = speed ? 30 : 1;
      for (let k = 1; k <= frames; k++) {
        const upto = Math.ceil((lossShown.length * k) / frames);
        const pts = lossShown.slice(0, upto);
        Charts.plot(lossBox, {
          height: 190, margin: { left: 50, bottom: 38, top: 10, right: 16 },
          x: { label: `epoch (first 200 of ${loss.length - 1})`, domain: [0, 200] },
          y: { label: "MSE", domain: [Math.floor(tm.gd.loss[tm.gd.loss.length - 1] * 100 - 1) / 100, Math.ceil(tm.gd.loss[0] * 100) / 100], format: (v) => v.toFixed(2) },
          lines: [{ points: pts, color: "var(--s1)", width: 2, hover: true }],
          lineTip: (x, ps) => `<b>epoch ${x}</b><br>MSE ${ps[0].y.toFixed(4)}`,
        });
        setStage("train", "running", `Training… epoch ${pts[pts.length - 1].x} · MSE ${pts[pts.length - 1].y.toFixed(4)}`, 30 + (55 * k) / frames);
        if (speed) await wait(55);
      }
      const maxDiff = Math.max(...tm.coefs.map((c) => Math.abs(c.gd - c.b)));
      $(".coef", d).innerHTML = `<p class="mini-title" style="margin-top:12px">Learned coefficients (target: ln(wage)) · gradient descent matches the exact least-squares solution within ${maxDiff.toExponential(1)}</p>` +
        table([
          { key: "name", label: "feature", f: (v) => esc(NICE[v] || v) },
          { key: "gd", label: "gradient descent", f: (v) => v.toFixed(5) },
          { key: "b", label: "least squares", f: (v) => v.toFixed(5) },
          { key: "se", label: "std. error", f: (v) => v.toFixed(5) },
          { key: "p", label: "p-value", f: (v) => (v < 0.001 ? "<0.001" : v.toFixed(3)), cls: (v) => (v < 0.05 ? "ok" : "warn") },
        ], tm.coefs);
      Flow.swirl(false);
      await wait(900);
      setStage("train", "done", `Model trained on ${tm.split.train} rows · ${tm.gd.loss.length - 1} epochs · final MSE ${tm.gd.loss[tm.gd.loss.length - 1].toFixed(4)}`, 100);

      // 6. Predict
      focusStage("predict");
      Flow.moveTo(5);
      d = setStage("predict", "running", "Scoring held-out rows…", 30);
      await wait(600);
      const pr = P.predict(tm);
      Flow.recolor("--s2");
      d.innerHTML = `<div class="meta">
          <div><b class="num">${(pr.test.r2Wage * 100).toFixed(1)}%</b><span>of wage variation explained (test R²)</span></div>
          <div><b class="num">${fmt$(pr.test.mae)}</b><span>mean absolute error / hour</span></div>
          <div><b class="num">${fmt$(pr.test.rmse)}</b><span>root mean squared error</span></div>
          <div><b class="num">${pr.test.n}</b><span>unseen test rows scored</span></div></div>
        <button class="btn" id="toResults">↓ See the wage curves & predictions</button>`;
      $("#toResults").addEventListener("click", () => $("#results").scrollIntoView({ behavior: "smooth" }));
      await wait(900);
      Flow.exit();
      setStage("predict", "done", `wage_forecast ready · test R² ${pr.test.r2Wage.toFixed(3)}`, 100);
      state = { up, val, cl, tr, tm, pr };
      await wait(600);
      renderResults(state);
    } catch (err) {
      console.error(err);
      const active = document.querySelector(".stage.running");
      if (active) setStage(active.dataset.stage, "error", esc(err.message), 100);
    } finally {
      running = false;
      $("#run").disabled = false;
    }
  }
  const sum = (a) => a.reduce((s, v) => s + v, 0);

  // ---------- results ----------
  function renderResults(s) {
    const { tm, pr, tr } = s;
    const res = $("#results");
    res.hidden = false;
    const c = Object.fromEntries(tm.coefs.map((x) => [x.name, x]));
    const meanExper = tm.means.exper;
    const expEffect = (c.exper.b + 2 * c.expersq.b * meanExper);
    const tiles = [
      { label: "Each extra year of education", value: fmtPct(c.educ.pct), note: "higher hourly wage, all else equal" },
      { label: "Wage peaks after", value: pr.peak ? `${pr.peak.toFixed(0)} yrs` : "n/a", note: "of work experience" },
      c.tenure && { label: "Each year with the same employer", value: fmtPct(c.tenure.pct), note: "on top of general experience" },
      c.female && { label: "Gender gap", value: fmtPct(c.female.pct), note: "women vs. comparable men" },
      { label: "Test R²", value: pr.test.r2Wage.toFixed(2), note: `on ${pr.test.n} unseen rows · MAE ${fmt$(pr.test.mae)}` },
    ].filter(Boolean);
    $("#tiles").innerHTML = tiles.map((t) => `<div class="tile"><div class="label">${t.label}</div><div class="value">${t.value}</div><div class="note">${t.note}</div></div>`).join("");

    const w12 = pr.predictor.wage({ educ: 12 }), w16 = pr.predictor.wage({ educ: 16 });
    $("#narrative").innerHTML = `For a typical worker (average experience${c.tenure ? ", tenure" : ""} and demographics), the model predicts <b>${fmt$(w12)}/hour</b> with a high-school education (12 years) and <b>${fmt$(w16)}/hour</b> with a college degree (16 years), a gap of <b>${fmtPct(100 * (w16 / w12 - 1), 0)}</b>. ` +
      `Experience pays too, but with diminishing returns: around the average career length (${meanExper.toFixed(0)} years), one more year adds about <b>${fmtPct(100 * (Math.exp(expEffect) - 1))}</b>, and the curve tops out after roughly <b>${pr.peak ? pr.peak.toFixed(0) : "–"} years</b>. ` +
      `The model explains about <b>${(pr.test.r2Wage * 100).toFixed(0)}%</b> of the wage differences between people it never saw during training; the rest comes from factors not in the data.`;

    drawCharts(s);
    buildPredictor(s);
    buildTable(s);
    buildMethod(s);
    if (speed && autoScroll) setTimeout(() => res.scrollIntoView({ behavior: "smooth" }), 200);
  }

  function drawCharts(s) {
    const { tm, pr, tr } = s;
    const allRows = tr.rows;
    const maxWage = Math.min(26, Math.ceil(Math.max(...allRows.map((r) => r.wage)) / 2) * 2);

    // A. Sample regression curves vs population estimate
    $("#legendA").innerHTML = `<span><i class="dot" style="background:var(--muted)"></i>people in the data</span>
      <span><i class="thin" style="background:var(--s1);opacity:.45"></i>sample regression curves (${pr.bootCurves.length} resamples)</span>
      <span><i class="band" style="background:var(--s1)"></i>95% band</span>
      <span><i style="background:var(--s2);height:4px"></i>estimated population curve</span>`;
    Charts.plot($("#chartEduc"), {
      ariaLabel: "Hourly wage against years of education with fitted curves",
      x: { label: "years of education", domain: [0, 18] },
      y: { label: "hourly wage ($)", domain: [0, maxWage], format: (v) => "$" + v },
      points: allRows.map((r) => ({ x: r.educ, y: r.wage, r })), pointColor: "var(--muted)", pointOpacity: 0.35, jitter: 0.6,
      pointTip: (p) => `<b>${fmt$(p.r.wage)}/hr</b><br>${p.r.educ} yrs education · ${p.r.exper} yrs experience`,
      band: { points: pr.band, color: "var(--s1)" },
      lines: pr.bootCurves.map((pts) => ({ points: pts, color: "var(--s1)", width: 1, opacity: 0.35 }))
        .concat([{ points: pr.popCurve, color: "var(--s2)", width: 3.5, hover: true, label: "population estimate" }]),
      lineTip: (x, ps) => { const b = pr.band.find((q) => q.x === x); return `<b>${x} years of education</b><br><span class="sw" style="background:var(--s2)"></span>predicted ${fmt$(ps[0].y)}/hr<br><span class="muted">95% band ${fmt$(b.lo)} – ${fmt$(b.hi)}</span>`; },
    });

    // B. Experience curves by education level
    const colors = ["var(--s1)", "var(--s2)", "var(--s3)"];
    const labels = { 10: "10 yrs educ.", 12: "12 yrs (high school)", 16: "16 yrs (college)" };
    $("#legendB").innerHTML = pr.experCurves.map((c, i) => `<span><i style="background:${colors[i]}"></i>${labels[c.educ]}</span>`).join("");
    const maxY = Math.ceil(Math.max(...pr.experCurves.flatMap((c) => c.points.map((p) => p.y))) + 1);
    Charts.plot($("#chartExper"), {
      ariaLabel: "Predicted wage across years of experience for three education levels",
      x: { label: "years of experience", domain: [0, 50] },
      y: { label: "predicted hourly wage ($)", domain: [0, maxY], format: (v) => "$" + v },
      lines: pr.experCurves.map((c, i) => ({ points: c.points, color: colors[i], width: 2.5, hover: true, label: `${c.educ} yrs educ.`, labelX: pr.peak || 25, labelBelow: i === 0 })),
      lineTip: (x, ps, ls) => `<b>${x} years of experience</b>` + ps.slice().reverse().map((p, i) => { const j = ps.length - 1 - i; return `<br><span class="sw" style="background:${ls[j].color}"></span>${labels[pr.experCurves[j].educ]}: ${fmt$(p.y)}`; }).join(""),
    });

    // C. Predicted vs actual
    const lim = Math.ceil(Math.max(...pr.testPreds.map((r) => Math.max(r.wage, r.predicted))) / 5) * 5;
    Charts.plot($("#chartPva"), {
      ariaLabel: "Predicted versus actual wage on test rows",
      x: { label: "actual hourly wage ($)", domain: [0, lim], format: (v) => "$" + v },
      y: { label: "predicted hourly wage ($)", domain: [0, lim], format: (v) => "$" + v },
      points: pr.testPreds.map((r) => ({ x: r.wage, y: r.predicted, r })), pointColor: "var(--s2)", pointOpacity: 0.7, pointRadius: 4,
      diagonal: true,
      pointTip: (p) => `<b>actual ${fmt$(p.r.wage)} · predicted ${fmt$(p.r.predicted)}</b><br>${p.r.educ} yrs educ · ${p.r.exper} yrs exper${p.r.tenure != null ? ` · ${p.r.tenure} yrs tenure` : ""}`,
    });

    // D. Effects
    const items = tm.coefs.filter((c) => c.name !== "intercept" && c.name !== "expersq").map((c) => {
      let b = c.b, se = c.se, label = NICE[c.name];
      if (c.name === "exper") {
        // marginal effect at mean experience: b1 + 2*b2*x, se via delta method
        const iE = tm.features.indexOf("exper") + 1, iS = tm.features.indexOf("expersq") + 1, V = tm.model.XtXi, s2 = tm.model.sigma2, m = tm.means.exper;
        b = c.b + 2 * tm.coefs[iS].b * m;
        se = Math.sqrt(s2 * (V[iE][iE] + 4 * m * m * V[iS][iS] + 4 * m * V[iE][iS]));
        label = `Experience (at ${m.toFixed(0)} yrs)`;
      }
      const pct = (v) => 100 * (Math.exp(v) - 1);
      return { label, value: pct(b), lo: pct(b - 1.96 * se), hi: pct(b + 1.96 * se), color: b >= 0 ? "var(--s1)" : "var(--neg)",
        tip: `<b>${label}</b><br>${fmtPct(pct(b))} wage<br><span class="muted">95% CI ${fmtPct(pct(b - 1.96 * se))} to ${fmtPct(pct(b + 1.96 * se))}</span>` };
    });
    Charts.bars($("#chartEffects"), items, { xLabel: "% change in hourly wage", format: (v) => v + "%", margin: { left: 150, right: 20, top: 10, bottom: 36 } });
  }

  function buildPredictor(s) {
    const { pr, tm, val } = s;
    const inputs = { educ: 16, exper: 10, tenure: 3, female: 0, married: 0 };
    const sliders = [["educ", "Years of education", 0, 18], ["exper", "Years of experience", 0, 50]];
    if (tm.features.includes("tenure")) sliders.push(["tenure", "Years with current employer", 0, 44]);
    const toggles = [];
    if (tm.features.includes("female")) toggles.push(["female", ["Male", "Female"]]);
    if (tm.features.includes("married")) toggles.push(["married", ["Not married", "Married"]]);
    const form = $("#predictorForm");
    form.innerHTML = sliders.map(([k, l, a, b]) => `<label>${l}<output id="o-${k}">${inputs[k]}</output><input type="range" min="${a}" max="${b}" step="1" value="${inputs[k]}" data-k="${k}"></label>`).join("") +
      `<div class="seg-row">${toggles.map(([k, opts]) => `<div class="seg" data-k="${k}">${opts.map((o, i) => `<button type="button" data-v="${i}" class="${inputs[k] === i ? "on" : ""}">${o}</button>`).join("")}</div>`).join("")}</div>`;
    const update = () => {
      if (inputs.tenure > inputs.exper) inputs.tenure = inputs.exper;
      const t = form.querySelector('input[data-k="tenure"]');
      if (t) { t.value = inputs.tenure; $("#o-tenure").textContent = inputs.tenure; }
      const q = pr.predictor.interval(inputs);
      $("#predValue").textContent = fmt$(q.wage) + " / hour";
      $("#predRange").innerHTML = `Average for this profile: ${fmt$(q.meanLo)} – ${fmt$(q.meanHi)} · an individual: ${fmt$(q.lo)} – ${fmt$(q.hi)}`;
      const max = Math.max(30, q.hi * 1.05), pos = (v) => (100 * v) / max + "%";
      const bar = $("#predBar");
      Object.assign(bar.querySelector(".pi").style, { left: pos(q.lo), width: `calc(${pos(q.hi)} - ${pos(q.lo)})` });
      Object.assign(bar.querySelector(".ci").style, { left: pos(q.meanLo), width: `calc(${pos(q.meanHi)} - ${pos(q.meanLo)})` });
      bar.querySelector(".pt").style.left = `calc(${pos(q.wage)} - 2px)`;
    };
    form.querySelectorAll("input[type=range]").forEach((inp) => inp.addEventListener("input", () => { inputs[inp.dataset.k] = +inp.value; $("#o-" + inp.dataset.k).textContent = inp.value; update(); }));
    form.querySelectorAll(".seg").forEach((seg) => seg.addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      inputs[seg.dataset.k] = +b.dataset.v;
      seg.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
      update();
    }));
    update();
  }

  function buildTable(s) {
    const { pr, tm } = s;
    const cols = ["educ", "exper"].concat(tm.features.filter((f) => ["tenure", "female", "married"].includes(f)));
    const rows = pr.testPreds.slice().sort((a, b) => a.educ - b.educ || a.exper - b.exper);
    $("#predTable").innerHTML = `<thead><tr>${cols.map((c) => `<th>${c}</th>`).join("")}<th>actual wage</th><th>predicted wage</th><th>error</th></tr></thead><tbody>` +
      rows.map((r) => `<tr>${cols.map((c) => `<td>${r[c]}</td>`).join("")}<td>${fmt$(r.wage)}</td><td><b>${fmt$(r.predicted)}</b></td><td class="${Math.abs(r.error) > 3 ? "warn" : ""}">${r.error >= 0 ? "+" : "−"}${fmt$(Math.abs(r.error))}</td></tr>`).join("") + "</tbody>";
    $("#download").onclick = () => {
      const all = tm.trainRows.map((r) => ({ ...r, split: "train" })).concat(tm.testRows.map((r) => ({ ...r, split: "test" })));
      const header = cols.concat(["wage", "predicted_wage", "error", "split"]);
      const lines = [header.join(",")].concat(all.map((r) => { const p = pr.predictor.wage(r); return cols.map((c) => r[c]).concat([r.wage.toFixed(2), p.toFixed(2), (p - r.wage).toFixed(2), r.split]).join(","); }));
      const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
      const a = Object.assign(document.createElement("a"), { href: url, download: "wage_predictions.csv" });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
  }

  function buildMethod(s) {
    const { tm, pr } = s;
    const terms = tm.coefs.map((c, i) => (i === 0 ? c.b.toFixed(3) : `${c.b >= 0 ? "+ " : "− "}${Math.abs(c.b).toFixed(4)}·${c.name}`)).join(" ");
    $("#method").innerHTML = `
      <p>The model is a log-linear (Mincer) wage equation. Taking the log of wage makes each coefficient read as an approximate percentage effect and tames the long right tail of wages:</p>
      <p class="eq">ln(wage) = ${terms}</p>
      <ul>
        <li><b>Population vs. sample.</b> The <em>population regression function</em> is the true average wage for every combination of education and experience, and nobody observes it. Any dataset is one sample, and a curve fitted to it is a <em>sample regression function</em>. Refitting on ${pr.bootCurves.length} bootstrap resamples shows how much that sample curve moves; the 95% band is where the population curve most plausibly lies.</li>
        <li><b>Training.</b> Features are standardised and the weights are learned by batch gradient descent (${tm.gd.loss.length - 1} epochs, learning rate 0.5). The result is checked against the exact least-squares solution; standard errors and p-values come from the least-squares fit.</li>
        <li><b>Back to dollars.</b> Predictions are converted from ln(wage) to $ with Duan's smearing factor (${tm.model.smear.toFixed(3)}), because exp(E[ln wage]) underestimates the average wage.</li>
        <li><b>Honest evaluation.</b> ${tm.split.test} rows (20%) were held out and never used for training. Test R² ${pr.test.r2Wage.toFixed(3)} vs. train R² ${pr.train.r2Wage.toFixed(3)}; the two are similar, so the model is not overfitting.</li>
        <li><b>Caveat.</b> These are associations, not causal effects: ability, field of study and location also shape wages and are only partly captured.</li>
      </ul>`;
  }

  // Redraw charts on resize (debounced) so SVGs stay crisp and fit the width.
  let rt;
  window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { if (state && !$("#results").hidden) drawCharts(state); }, 200); });

  Flow.init($("#pipeline"), $("#flow"));
  // Show the file dropping in straight away on first load.
  run();
})();
