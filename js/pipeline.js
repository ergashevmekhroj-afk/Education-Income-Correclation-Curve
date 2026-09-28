// Pure data pipeline: parse -> validate -> clean -> transform -> train -> predict.
// No DOM access here, so every stage can be tested/reused independently.
(function (global) {
  "use strict";

  const REQUIRED = ["wage", "educ", "exper"];
  // Optional predictors used when present in the file.
  const OPTIONAL = ["tenure", "female", "married"];
  const RANGES = {
    wage: [0, 1000, "hourly wage must be > 0"],
    educ: [0, 25, "years of education 0-25"],
    exper: [0, 70, "years of experience 0-70"],
    tenure: [0, 70, "years with employer 0-70"],
    female: [0, 1, "binary 0/1"],
    married: [0, 1, "binary 0/1"],
  };
  const MISSING_TOKENS = new Set(["", "na", "nan", "null", "none", "?", "-"]);

  // ---------- utilities ----------
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, rand) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  const sum = (a) => a.reduce((s, v) => s + v, 0);
  const mean = (a) => sum(a) / a.length;
  function std(a) {
    const m = mean(a);
    return Math.sqrt(sum(a.map((v) => (v - m) ** 2)) / (a.length - 1));
  }
  function quantile(sorted, q) {
    const pos = (sorted.length - 1) * q;
    const lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }
  function median(a) {
    return quantile(a.slice().sort((x, y) => x - y), 0.5);
  }

  // ---------- linear algebra (small dense matrices) ----------
  function transposeMul(X, Y) {
    // X^T Y where X is n x p, Y is n x q
    const p = X[0].length, q = Y[0].length;
    const out = Array.from({ length: p }, () => new Array(q).fill(0));
    for (let i = 0; i < X.length; i++) {
      const xi = X[i], yi = Y[i];
      for (let a = 0; a < p; a++) {
        const v = xi[a];
        if (v === 0) continue;
        for (let b = 0; b < q; b++) out[a][b] += v * yi[b];
      }
    }
    return out;
  }
  function invert(M) {
    const n = M.length;
    const A = M.map((row, i) => row.concat(Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))));
    for (let c = 0; c < n; c++) {
      let piv = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
      if (Math.abs(A[piv][c]) < 1e-12) throw new Error("Design matrix is singular (a feature has no variation or duplicates another).");
      [A[c], A[piv]] = [A[piv], A[c]];
      const d = A[c][c];
      for (let k = 0; k < 2 * n; k++) A[c][k] /= d;
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = A[r][c];
        if (f === 0) continue;
        for (let k = 0; k < 2 * n; k++) A[r][k] -= f * A[c][k];
      }
    }
    return A.map((row) => row.slice(n));
  }
  const matVec = (M, v) => M.map((row) => sum(row.map((x, i) => x * v[i])));
  const dot = (a, b) => sum(a.map((x, i) => x * b[i]));

  // Two-sided p-value for a t statistic (normal approx is fine for df > 100; use t via incomplete beta otherwise).
  function pValue(t, df) {
    const x = df / (df + t * t);
    return incBeta(x, df / 2, 0.5);
  }
  function incBeta(x, a, b) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    const lbeta = lgamma(a + b) - lgamma(a) - lgamma(b);
    const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b + lbeta);
    if (x < (a + 1) / (a + b + 2)) return (front * betacf(x, a, b)) / a;
    return 1 - (Math.exp(Math.log(1 - x) * b + Math.log(x) * a + lbeta) * betacf(1 - x, b, a)) / b;
  }
  function betacf(x, a, b) {
    let c = 1, d = 1 - ((a + b) * x) / (a + 1);
    d = 1 / (Math.abs(d) < 1e-30 ? 1e-30 : d);
    let h = d;
    for (let m = 1; m <= 200; m++) {
      const m2 = 2 * m;
      let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
      d = 1 + aa * d; d = 1 / (Math.abs(d) < 1e-30 ? 1e-30 : d);
      c = 1 + aa / c; if (Math.abs(c) < 1e-30) c = 1e-30;
      h *= d * c;
      aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
      d = 1 + aa * d; d = 1 / (Math.abs(d) < 1e-30 ? 1e-30 : d);
      c = 1 + aa / c; if (Math.abs(c) < 1e-30) c = 1e-30;
      const del = d * c;
      h *= del;
      if (Math.abs(del - 1) < 3e-12) break;
    }
    return h;
  }
  function lgamma(z) {
    const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
    let x = z, y = z, tmp = x + 5.5;
    tmp -= (x + 0.5) * Math.log(tmp);
    let ser = 1.000000000190015;
    for (const c of g) ser += c / ++y;
    return -tmp + Math.log((2.5066282746310005 * ser) / x);
  }

  // ---------- Stage 1: upload / parse ----------
  function parseCSV(text) {
    const rows = [];
    let field = "", row = [], inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
        } else field += ch;
      } else if (ch === '"') inQuotes = true;
      else if (ch === ",") { row.push(field); field = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(field); field = "";
        if (row.length > 1 || row[0] !== "") rows.push(row);
        row = [];
      } else field += ch;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    if (rows.length < 2) throw new Error("The file has no data rows.");
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const records = rows.slice(1).map((r) => {
      const o = {};
      header.forEach((h, j) => {
        const raw = (r[j] ?? "").trim();
        if (MISSING_TOKENS.has(raw.toLowerCase())) o[h] = null;
        else {
          const n = Number(raw);
          o[h] = Number.isFinite(n) ? n : raw;
        }
      });
      return o;
    });
    return { header, records };
  }

  function upload(text, name) {
    const { header, records } = parseCSV(text);
    return {
      name,
      bytes: new Blob([text]).size,
      header,
      records,
      summary: { rows: records.length, columns: header.length },
    };
  }

  // Deterministically dirty a copy of the data so the cleaning stage has work to show.
  function injectMess(text, seed = 7) {
    const rand = mulberry32(seed);
    const lines = text.trim().split(/\r?\n/);
    const header = lines[0].split(",");
    const body = lines.slice(1);
    const col = (n) => header.indexOf(n);
    const blank = (line, c) => { const f = line.split(","); f[c] = ""; return f.join(","); };
    // 9 rows with a missing optional value (tenure) -> imputed, not dropped
    const base = body.slice();
    for (let i = 0; i < 9 && col("tenure") >= 0; i++) {
      const k = Math.floor(rand() * base.length);
      base[k] = blank(base[k], col("tenure"));
    }
    const out = base.slice();
    // 18 exact duplicate rows
    for (let i = 0; i < 18; i++) out.push(base[Math.floor(rand() * base.length)]);
    // 12 rows with missing required values
    for (let i = 0; i < 12; i++) out.push(blank(base[Math.floor(rand() * base.length)], col(["wage", "educ", "exper"][i % 3])));
    // 6 invalid values (negative wage, impossible education)
    for (let i = 0; i < 6; i++) {
      const f = body[Math.floor(rand() * body.length)].split(",");
      if (i % 2 === 0) f[col("wage")] = String(-(1 + Math.floor(rand() * 9)));
      else f[col("educ")] = "99";
      out.push(f.join(","));
    }
    return [lines[0]].concat(shuffle(out, rand)).join("\n");
  }

  // ---------- Stage 2: validation ----------
  function validate(up) {
    const { header, records } = up;
    const checks = [];
    const missingCols = REQUIRED.filter((c) => !header.includes(c));
    checks.push({
      ok: missingCols.length === 0,
      label: missingCols.length ? `Missing required column(s): ${missingCols.join(", ")}` : `Required columns present: ${REQUIRED.join(", ")}`,
    });
    const optionalFound = OPTIONAL.filter((c) => header.includes(c));
    checks.push({ ok: true, info: true, label: optionalFound.length ? `Optional predictors found: ${optionalFound.join(", ")}` : "No optional predictors found (model will use education + experience only)" });

    const schema = header.map((h) => {
      let nulls = 0, nonNumeric = 0, outOfRange = 0, min = Infinity, max = -Infinity;
      const r = RANGES[h];
      for (const rec of records) {
        const v = rec[h];
        if (v === null) nulls++;
        else if (typeof v !== "number") nonNumeric++;
        else {
          if (v < min) min = v;
          if (v > max) max = v;
          if (r && (v < r[0] || v > r[1] || (h === "wage" && v <= 0))) outOfRange++;
        }
      }
      return {
        column: h,
        type: nonNumeric > 0 ? "text" : "numeric",
        nulls, nonNumeric, outOfRange,
        min: Number.isFinite(min) ? min : null,
        max: Number.isFinite(max) ? max : null,
        role: REQUIRED.includes(h) ? "required" : OPTIONAL.includes(h) ? "predictor" : "ignored",
        rule: r ? r[2] : null,
      };
    });
    const used = schema.filter((s) => s.role !== "ignored");
    const badTypes = used.filter((s) => s.type !== "numeric");
    checks.push({ ok: badTypes.length === 0, label: badTypes.length ? `Non-numeric values in: ${badTypes.map((s) => s.column).join(", ")} (rows will be dropped)` : "All model columns are numeric", warn: badTypes.length > 0 });
    const nullCount = sum(used.map((s) => s.nulls));
    checks.push({ ok: nullCount === 0, warn: nullCount > 0, label: nullCount ? `${nullCount} missing value(s) in model columns -> cleaning` : "No missing values in model columns" });
    const oor = sum(used.map((s) => s.outOfRange));
    checks.push({ ok: oor === 0, warn: oor > 0, label: oor ? `${oor} out-of-range value(s) -> cleaning` : "All values inside plausible ranges" });
    checks.push({ ok: records.length >= 30, label: `${records.length.toLocaleString()} rows (minimum 30 needed to fit the model)` });

    const fatal = missingCols.length > 0 || records.length < 30;
    return { checks, schema, fatal, optionalFound, rows: records.length };
  }

  // ---------- Stage 3: cleaning ----------
  function clean(up, val) {
    const cols = REQUIRED.concat(val.optionalFound);
    const status = new Array(up.records.length).fill("kept");
    const reasons = { missingRequired: 0, nonNumeric: 0, invalid: 0, duplicate: 0 };
    const seen = new Set();
    up.records.forEach((rec, i) => {
      if (REQUIRED.some((c) => rec[c] === null)) { status[i] = "missing"; reasons.missingRequired++; return; }
      if (cols.some((c) => rec[c] !== null && typeof rec[c] !== "number")) { status[i] = "invalid"; reasons.nonNumeric++; return; }
      if (cols.some((c) => { const r = RANGES[c], v = rec[c]; return v !== null && r && (v < r[0] || v > r[1] || (c === "wage" && v <= 0)); })) { status[i] = "invalid"; reasons.invalid++; return; }
      const key = up.header.map((h) => rec[h]).join("|");
      if (seen.has(key)) { status[i] = "duplicate"; reasons.duplicate++; return; }
      seen.add(key);
    });
    // Impute missing optional predictors with the median of kept rows (binary -> mode via rounding).
    const imputed = {};
    const kept = up.records.filter((_, i) => status[i] === "kept").map((r) => Object.assign({}, r));
    for (const c of val.optionalFound) {
      const vals = kept.map((r) => r[c]).filter((v) => v !== null);
      let fill = median(vals);
      if (c === "female" || c === "married") fill = Math.round(fill);
      let n = 0;
      kept.forEach((r) => { if (r[c] === null) { r[c] = fill; n++; } });
      if (n) imputed[c] = { count: n, value: fill };
    }
    return { status, reasons, imputed, records: kept, removed: up.records.length - kept.length };
  }

  // ---------- Stage 4: transform / feature creation ----------
  function transform(cl, val) {
    const features = ["educ", "exper", "expersq"];
    if (val.optionalFound.includes("tenure")) features.push("tenure");
    if (val.optionalFound.includes("female")) features.push("female");
    if (val.optionalFound.includes("married")) features.push("married");
    const rows = cl.records.map((r) => {
      const o = { wage: r.wage, educ: r.educ, exper: r.exper };
      o.lwage = Math.log(r.wage);
      o.expersq = r.exper * r.exper;
      for (const c of val.optionalFound) o[c] = r[c];
      o.educ_level = r.educ < 12 ? "< High school" : r.educ === 12 ? "High school" : r.educ < 16 ? "Some college" : "College+";
      return o;
    });
    const wages = rows.map((r) => r.wage), lw = rows.map((r) => r.lwage);
    const skew = (a) => { const m = mean(a), s = std(a); return mean(a.map((v) => ((v - m) / s) ** 3)); };
    const created = [
      { name: "lwage", formula: "ln(wage)", why: "wages are right-skewed; logs turn coefficients into % effects" },
      { name: "expersq", formula: "exper²", why: "lets the wage-experience curve bend (diminishing returns)" },
      { name: "educ_level", formula: "bucket(educ)", why: "readable groups for charts (not a model input)" },
    ];
    return { rows, features, created, skew: { wage: skew(wages), lwage: skew(lw) } };
  }

  // ---------- Stage 5: training ----------
  function designRow(r, features) {
    return [1].concat(features.map((f) => r[f]));
  }
  function ols(rows, features) {
    const X = rows.map((r) => designRow(r, features));
    const y = rows.map((r) => [r.lwage]);
    const XtX = transposeMul(X, X);
    const XtXi = invert(XtX);
    const beta = matVec(XtXi, transposeMul(X, y).map((v) => v[0]));
    const resid = rows.map((r, i) => r.lwage - dot(X[i], beta));
    const n = rows.length, p = beta.length;
    const sigma2 = sum(resid.map((e) => e * e)) / (n - p);
    const se = XtXi.map((row, i) => Math.sqrt(sigma2 * row[i]));
    const smear = mean(resid.map((e) => Math.exp(e))); // Duan's smearing for back-transforming to $
    return { beta, se, sigma2, XtXi, resid, smear, df: n - p };
  }

  // Batch gradient descent on standardized features: the "machine learning" view of the same model.
  function gradientDescent(rows, features, { epochs = 600, lr = 0.5 } = {}) {
    const mu = features.map((f) => mean(rows.map((r) => r[f])));
    const sd = features.map((f, j) => std(rows.map((r) => r[f])) || 1);
    const Z = rows.map((r) => features.map((f, j) => (r[f] - mu[j]) / sd[j]));
    const y = rows.map((r) => r.lwage);
    const n = rows.length, p = features.length;
    // Start from the "predict the average" model, so the loss curve shows the slopes being learned.
    let w = new Array(p).fill(0), b = mean(y);
    const loss = [];
    for (let e = 0; e <= epochs; e++) {
      const gw = new Array(p).fill(0);
      let gb = 0, l = 0;
      for (let i = 0; i < n; i++) {
        const err = b + dot(w, Z[i]) - y[i];
        l += err * err;
        gb += err;
        for (let j = 0; j < p; j++) gw[j] += err * Z[i][j];
      }
      loss.push(l / n);
      if (e === epochs) break;
      b -= (lr * gb) / n;
      for (let j = 0; j < p; j++) w[j] -= (lr * gw[j]) / n;
    }
    // Map standardized weights back to the raw feature scale.
    const raw = w.map((wj, j) => wj / sd[j]);
    const intercept = b - sum(raw.map((c, j) => c * mu[j]));
    return { beta: [intercept].concat(raw), loss };
  }

  function train(tr, { seed = 42, testShare = 0.2, bootstraps = 40 } = {}) {
    const rand = mulberry32(seed);
    const idx = shuffle(tr.rows.map((_, i) => i), rand);
    const nTest = Math.round(tr.rows.length * testShare);
    const testIdx = new Set(idx.slice(0, nTest));
    const trainRows = tr.rows.filter((_, i) => !testIdx.has(i));
    const testRows = tr.rows.filter((_, i) => testIdx.has(i));
    const model = ols(trainRows, tr.features);
    const gd = gradientDescent(trainRows, tr.features);
    const coefs = ["intercept"].concat(tr.features).map((name, i) => {
      const b = model.beta[i], se = model.se[i], t = b / se;
      return { name, b, se, t, p: pValue(t, model.df), pct: 100 * (Math.exp(b) - 1), gd: gd.beta[i] };
    });
    // Bootstrap: each resample gives one *sample* regression function; together they show
    // how much the estimate of the population curve moves from sample to sample.
    const boot = [];
    const brand = mulberry32(seed + 1);
    for (let k = 0; k < bootstraps; k++) {
      const sample = trainRows.map(() => trainRows[Math.floor(brand() * trainRows.length)]);
      try { boot.push(ols(sample, tr.features)); } catch (e) { /* singular resample: skip */ }
    }
    const means = {};
    for (const f of tr.features) means[f] = mean(trainRows.map((r) => r[f]));
    return { features: tr.features, trainRows, testRows, model, gd, coefs, boot, means, split: { train: trainRows.length, test: testRows.length } };
  }

  // ---------- Stage 6: prediction ----------
  function makePredictor(tm) {
    const { model, features } = tm;
    function row(input) {
      const r = Object.assign({}, tm.means, input);
      r.expersq = r.exper * r.exper;
      return designRow(r, features);
    }
    return {
      logWage: (input, beta = model.beta) => dot(row(input), beta),
      wage: (input, m = model) => Math.exp(dot(row(input), m.beta)) * m.smear,
      interval: (input) => {
        const x = row(input);
        const fit = dot(x, model.beta);
        const seMean = Math.sqrt(dot(x, matVec(model.XtXi, x)) * model.sigma2);
        const sePred = Math.sqrt(model.sigma2 + seMean * seMean);
        return {
          wage: Math.exp(fit) * model.smear,
          meanLo: Math.exp(fit - 1.96 * seMean) * model.smear,
          meanHi: Math.exp(fit + 1.96 * seMean) * model.smear,
          lo: Math.exp(fit - 1.96 * sePred),
          hi: Math.exp(fit + 1.96 * sePred),
        };
      },
    };
  }

  function metrics(rows, predict) {
    const y = rows.map((r) => r.wage), yl = rows.map((r) => r.lwage);
    const p = rows.map((r) => predict.wage(r));
    const pl = rows.map((r) => predict.logWage(r));
    const r2 = (a, b) => { const m = mean(a); return 1 - sum(a.map((v, i) => (v - b[i]) ** 2)) / sum(a.map((v) => (v - m) ** 2)); };
    return {
      r2Log: r2(yl, pl),
      r2Wage: r2(y, p),
      rmse: Math.sqrt(mean(y.map((v, i) => (v - p[i]) ** 2))),
      mae: mean(y.map((v, i) => Math.abs(v - p[i]))),
      n: rows.length,
    };
  }

  function predict(tm) {
    const predictor = makePredictor(tm);
    const trainM = metrics(tm.trainRows, predictor);
    const testM = metrics(tm.testRows, predictor);
    const testPreds = tm.testRows.map((r) => ({ ...r, predicted: predictor.wage(r), error: predictor.wage(r) - r.wage }));
    const b = Object.fromEntries(tm.coefs.map((c) => [c.name, c.b]));
    const peak = b.expersq < 0 ? -b.exper / (2 * b.expersq) : null;
    // Holding everything else at its average, how does the curve move with education?
    const educGrid = Array.from({ length: 19 }, (_, i) => i);
    const popCurve = educGrid.map((e) => ({ x: e, y: predictor.wage({ educ: e }) }));
    const bootCurves = tm.boot.map((m) => educGrid.map((e) => ({ x: e, y: predictor.wage({ educ: e }, m) })));
    const band = educGrid.map((e, i) => {
      const ys = bootCurves.map((c) => c[i].y).sort((a, z) => a - z);
      return { x: e, lo: quantile(ys, 0.025), hi: quantile(ys, 0.975) };
    });
    const experGrid = Array.from({ length: 51 }, (_, i) => i);
    const experCurves = [10, 12, 16].map((ed) => ({ educ: ed, points: experGrid.map((x) => ({ x, y: predictor.wage({ educ: ed, exper: x }) })) }));
    return { predictor, train: trainM, test: testM, testPreds, peak, popCurve, bootCurves, band, experCurves };
  }

  global.Pipeline = { upload, validate, clean, transform, train, predict, injectMess, REQUIRED, OPTIONAL, util: { mean, std, quantile, mulberry32 } };
})(window);
