/* Workout analysis: resampling, adaptive interval detection (any rep length), NSA scoring, findings. */
(function (root) {
  const NSA = root.NSA = root.NSA || {};
  const N_ = () => NSA; // late binding to core

  /* ------------------------- small numeric helpers --------------------- */
  const isNum = (x) => typeof x === 'number' && isFinite(x);
  function mean(a) { let s = 0, n = 0; for (const x of a) if (isNum(x)) { s += x; n++; } return n ? s / n : NaN; }
  function median(a) { const b = a.filter(isNum).sort((x, y) => x - y); if (!b.length) return NaN; const m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; }
  function sd(a) { const m = mean(a); let s = 0, n = 0; for (const x of a) if (isNum(x)) { s += (x - m) ** 2; n++; } return n > 1 ? Math.sqrt(s / (n - 1)) : 0; }
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  function sliceMean(arr, a, b) { let s = 0, n = 0; for (let i = Math.max(0, Math.floor(a)); i < Math.min(arr.length, Math.ceil(b)); i++) if (isNum(arr[i])) { s += arr[i]; n++; } return n ? s / n : NaN; }

  function interpSeries(pairs, N, maxGap, step) {
    // pairs: [[t,val]] sorted by t ; returns Float64Array(N) with NaN where no data / gap > maxGap
    const out = new Float64Array(N).fill(NaN);
    if (!pairs.length) return out;
    let j = 0;
    for (let s = 0; s < N; s++) {
      while (j < pairs.length - 1 && pairs[j + 1][0] <= s) j++;
      const p = pairs[j], q = pairs[j + 1];
      if (s < pairs[0][0] - 0.5) continue;
      if (!q) { if (s - p[0] <= (maxGap || 5)) out[s] = p[1]; continue; }
      if (s === p[0]) { out[s] = p[1]; continue; }
      const gap = q[0] - p[0];
      if (maxGap != null && gap > maxGap) { // hold left value briefly, otherwise NaN
        if (s - p[0] <= 3) out[s] = p[1]; else if (q[0] - s <= 1) out[s] = q[1];
        continue;
      }
      if (step) out[s] = p[1]; else out[s] = p[1] + (q[1] - p[1]) * (s - p[0]) / gap;
    }
    return out;
  }

  /* ------------------------- preparation -------------------------------- */
  function haversine(la1, lo1, la2, lo2) {
    const R = 6371000, r = Math.PI / 180, dLa = (la2 - la1) * r, dLo = (lo2 - lo1) * r;
    const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(dLo / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  function prepare(raw) {
    const recs = raw.records.filter((r) => isNum(r.t)).sort((a, b) => a.t - b.t);
    if (recs.length < 30) throw new Error('This file has too little data to analyse (fewer than 30 points).');
    const T = Math.floor(recs[recs.length - 1].t), N = T + 1;
    if (N < 300) throw new Error('This activity is shorter than 5 minutes.');
    // distance
    let distPairs = recs.filter((r) => isNum(r.dist)).map((r) => [r.t, r.dist]);
    if (distPairs.length < recs.length * 0.5) {
      distPairs = []; let cum = 0, prev = null;
      for (const r of recs) {
        if (isNum(r.lat) && isNum(r.lon)) { if (prev) cum += haversine(prev.lat, prev.lon, r.lat, r.lon); prev = r; distPairs.push([r.t, cum]); }
      }
      if (distPairs.length < 30) { // fall back to integrating speed
        cum = 0; let pt = recs[0].t; distPairs = [];
        for (const r of recs) { if (isNum(r.speed)) cum += r.speed * (r.t - pt); pt = r.t; distPairs.push([r.t, cum]); }
      }
    }
    // dedupe times & enforce monotone distance
    const dp = []; let mx = 0;
    for (const p of distPairs) { mx = Math.max(mx, p[1]); if (dp.length && dp[dp.length - 1][0] === p[0]) dp[dp.length - 1][1] = mx; else dp.push([p[0], mx]); }
    const dist = interpSeries(dp, N, 120);
    for (let i = 0; i < N; i++) if (!isNum(dist[i])) dist[i] = i ? dist[i - 1] : 0;
    const hr = interpSeries(recs.filter((r) => isNum(r.hr) && r.hr > 30 && r.hr < 250).map((r) => [r.t, r.hr]), N, 15);
    const alt = interpSeries(recs.filter((r) => isNum(r.alt)).map((r) => [r.t, r.alt]), N, 30);
    const cad = interpSeries(recs.filter((r) => isNum(r.cad) && r.cad > 0).map((r) => [r.t, r.cad]), N, 15);
    const hrCount = recs.filter((r) => isNum(r.hr)).length;
    // smoothed altitude (median-ish via moving average 9 s)
    const altS = smooth(alt, 4);
    const w = { N, dist, hr, alt: altS, cad, hasHr: hrCount > N * 0.5, hasAlt: recs.filter((r) => isNum(r.alt)).length > N * 0.5 };
    w.v15 = speedSeries(dist, 7); w.v5 = speedSeries(dist, 2); w.v30 = speedSeries(dist, 15);
    return w;
  }
  function smooth(a, h) {
    const N = a.length, out = new Float64Array(N);
    for (let i = 0; i < N; i++) { let s = 0, n = 0; for (let j = Math.max(0, i - h); j <= Math.min(N - 1, i + h); j++) if (isNum(a[j])) { s += a[j]; n++; } out[i] = n ? s / n : NaN; }
    return out;
  }
  function speedSeries(dist, h) {
    const N = dist.length, v = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const a = Math.max(0, i - h), b = Math.min(N - 1, i + h);
      v[i] = b > a ? (dist[b] - dist[a]) / (b - a) : 0;
    }
    return v;
  }

  /* ------------------------- detection ---------------------------------- */
  function twoMeans(vals) {
    // vals: moving speeds. Otsu init, then k-means refine. returns {T, c1, c2}
    const lo = 0.5, hi = 9, bw = 0.04, nb = Math.ceil((hi - lo) / bw);
    const hist = new Float64Array(nb);
    for (const v of vals) { if (v < lo || v >= hi) continue; hist[Math.floor((v - lo) / bw)]++; }
    const total = hist.reduce((a, b) => a + b, 0); if (!total) return null;
    let sumAll = 0; for (let i = 0; i < nb; i++) sumAll += hist[i] * (lo + (i + 0.5) * bw);
    let wB = 0, sumB = 0, best = -1, bestI = 0;
    for (let i = 0; i < nb; i++) {
      wB += hist[i]; if (!wB) continue; const wF = total - wB; if (!wF) break;
      sumB += hist[i] * (lo + (i + 0.5) * bw);
      const mB = sumB / wB, mF = (sumAll - sumB) / wF, between = wB * wF * (mB - mF) ** 2;
      if (between > best) { best = between; bestI = i; }
    }
    let T = lo + (bestI + 1) * bw, c1 = 0, c2 = 0;
    for (let it = 0; it < 8; it++) {
      let s1 = 0, n1 = 0, s2 = 0, n2 = 0;
      for (const v of vals) { if (v < T) { s1 += v; n1++; } else { s2 += v; n2++; } }
      if (!n1 || !n2) return null;
      c1 = s1 / n1; c2 = s2 / n2; T = (c1 + c2) / 2;
    }
    return { T, c1, c2 };
  }

  // Work threshold: 2-means, then (if the upper group itself splits cleanly) 3-level handling so that
  // walking/standing rests, easy warm-up/cool-down and work reps are separated even when rests are very slow.
  function workThreshold(vals) {
    const km = twoMeans(vals); if (!km) return null;
    const upper = vals.filter((v) => v >= km.T);
    if (upper.length >= 360) {
      const k2 = twoMeans(upper);
      if (k2 && k2.c2 / k2.c1 >= 1.10) {
        const nHi = upper.filter((v) => v >= k2.T).length, nLo = upper.length - nHi;
        if (nHi >= 180 && nLo >= 180) return { T: k2.T, c1: k2.c1, c2: k2.c2, levels: 3 };
      }
    }
    return { T: km.T, c1: km.c1, c2: km.c2, levels: 2 };
  }

  function segmentsFromSpeed(w, sens) {
    const moving = []; for (let i = 0; i < w.N; i++) if (w.v15[i] > 0.8) moving.push(w.v15[i]);
    if (moving.length < 240) return null;
    const km = workThreshold(moving); if (!km) return null;
    const delta = km.c2 - km.c1;
    const T = km.T + (sens || 0) * 0.25 * delta;
    const Thi = T + 0.06 * delta, Tlo = T - 0.06 * delta;
    let segs = [], inW = false, start = 0;
    for (let s = 0; s < w.N; s++) {
      const v = w.v15[s];
      if (!inW && v >= Thi) { inW = true; start = s; } else if (inW && v < Tlo) { inW = false; segs.push([start, s]); }
    }
    if (inW) segs.push([start, w.N]);
    // refine edges using 5 s speed crossing T
    segs = segs.map(([a, b]) => {
      for (let k = 0; k < 20 && a > 0 && w.v5[a - 1] >= T; k++) a--;
      for (let k = 0; k < 20 && a < b - 1 && w.v5[a] < T; k++) a++;
      for (let k = 0; k < 20 && b < w.N && w.v5[b] >= T; k++) b++;
      for (let k = 0; k < 20 && b > a + 1 && w.v5[b - 1] < T; k++) b--;
      return [a, b];
    });
    // merge small gaps (GPS dropouts), drop tiny blips
    const merged = [];
    for (const s of segs) {
      const last = merged[merged.length - 1];
      if (last && s[0] - last[1] < 10) last[1] = s[1]; else merged.push(s.slice());
    }
    const keep = merged.filter(([a, b]) => b - a >= 30);
    return { segs: keep, T, c1: km.c1, c2: km.c2, levels: km.levels, sepRatio: km.c2 / km.c1, movingSec: moving.length };
  }

  function groupBlocks(segs, gapMax) {
    const blocks = []; let cur = [];
    for (const s of segs) {
      if (cur.length && s[0] - cur[cur.length - 1][1] > gapMax) { blocks.push(cur); cur = []; }
      cur.push(s);
    }
    if (cur.length) blocks.push(cur);
    return blocks;
  }
  function pickMainSets(segs) {
    // returns segments belonging to meaningful work blocks (drops strides / pick-ups)
    if (!segs.length) return { reps: [], dropped: [] };
    let blocks = groupBlocks(segs, 330);
    const workOf = (bl) => bl.reduce((s, x) => s + (x[1] - x[0]), 0);
    const totalWork = blocks.reduce((s, b) => s + workOf(b), 0);
    const dropped = [];
    blocks = blocks.filter((bl) => {
      const mean_ = workOf(bl) / bl.length;
      if (blocks.length > 1 && workOf(bl) < 0.2 * totalWork && mean_ < 60) { dropped.push(...bl); return false; }
      return true;
    });
    const out = [];
    for (let bl of blocks) {
      bl = bl.slice();
      if (bl.length >= 4) {
        const med = median(bl.map((x) => x[1] - x[0]));
        while (bl.length > 3 && (bl[0][1] - bl[0][0]) < 0.35 * med) dropped.push(bl.shift());
        while (bl.length > 3 && (bl[bl.length - 1][1] - bl[bl.length - 1][0]) < 0.35 * med) dropped.push(bl.pop());
      }
      out.push(...bl);
    }
    return { reps: out, dropped };
  }

  function segmentsFromLaps(raw, w) {
    const laps = (raw.laps || []).filter((l) => isNum(l.startT) && isNum(l.endT) && l.endT - l.startT > 3);
    if (laps.length < 4) return null;
    const has = (k) => laps.some((l) => l.intensity === k);
    const restLike = (l) => l.intensity === 'rest' || l.intensity === 'recovery';
    const workLike = (l) => l.intensity === 'active' || l.intensity === 'interval';
    if (!(laps.some(restLike) && laps.filter(workLike).length >= 2)) return null;
    const explicit = has('warmup') || has('cooldown');
    const lapSpeed = (l) => { const a = clamp(Math.round(l.startT), 0, w.N - 1), b = clamp(Math.round(l.endT), 0, w.N - 1); return b > a ? (w.dist[b] - w.dist[a]) / (b - a) : 0; };
    let workLaps = laps.filter(workLike);
    if (!explicit) {
      const sp = workLaps.map(lapSpeed).filter((x) => x > 0.8);
      const km = sp.length >= 3 ? workThreshold(sp) : null;
      if (!km || km.c2 / km.c1 < 1.06) return null;
      workLaps = workLaps.filter((l) => lapSpeed(l) >= km.T);
    }
    // merge laps belonging to the same workout step
    const segs = [];
    for (const l of workLaps) {
      const a = Math.round(l.startT), b = Math.round(l.endT);
      const last = segs[segs.length - 1];
      if (last && l.stepIdx != null && last.stepIdx === l.stepIdx && a - last.b <= 2) last.b = b;
      else segs.push({ a, b, stepIdx: l.stepIdx });
    }
    const out = segs.filter((s) => s.b - s.a >= 20).map((s) => [s.a, s.b]);
    if (out.length < 2) return null;
    // trailing rest lap after last rep?
    const lastB = out[out.length - 1][1];
    const trail = laps.find((l) => restLike(l) && Math.abs(Math.round(l.startT) - lastB) <= 3);
    const wu = laps.filter((l) => l.intensity === 'warmup'), cd = laps.filter((l) => l.intensity === 'cooldown');
    return { segs: out, explicit, trailingRest: trail ? Math.round(trail.endT - trail.startT) : 0,
      warmupSec: wu.reduce((s, l) => s + l.dur, 0) || null, cooldownSec: cd.reduce((s, l) => s + l.dur, 0) || null,
      restLaps: laps.filter(restLike).length };
  }

  /* ------------------------- metrics ------------------------------------ */
  function minettiRatio(g) {
    g = clamp(g, -0.10, 0.10);
    const C = (x) => 155.4 * x ** 5 - 30.4 * x ** 4 - 43.3 * x ** 3 + 46.3 * x ** 2 + 19.5 * x + 3.6;
    return C(g) / C(0);
  }
  function segMetrics(w, a, b) {
    const dur = b - a, dist = w.dist[Math.min(w.N - 1, b)] - w.dist[a];
    const pace = dist > 1 ? dur / (dist / 1000) : NaN;
    const hrAvg = sliceMean(w.hr, a, b);
    let hrMax = NaN; for (let i = a; i < b && i < w.N; i++) if (isNum(w.hr[i]) && !(hrMax >= w.hr[i])) hrMax = w.hr[i];
    const endHr = sliceMean(w.hr, Math.max(a, b - 10), b);
    const startHr = sliceMean(w.hr, a, Math.min(b, a + 5));
    let net = NaN, grade = NaN, adjPace = pace;
    if (w.hasAlt && dist > 50) {
      net = sliceMean(w.alt, b - 5, b) - sliceMean(w.alt, a, a + 5);
      grade = net / dist;
      if (isNum(grade) && Math.abs(net) >= 3) adjPace = pace / clamp(minettiRatio(grade), 0.94, 1.06);
    }
    return { a, b, dur, dist, pace, adjPace, hrAvg, hrMax, endHr, startHr, net, grade, cad: sliceMean(w.cad, a, b) };
  }

  /* ------------------------- scoring ------------------------------------ */
  function paceScore(dev) { // dev = (actual-target)/target ; + slower, - faster
    if (dev < -0.015) return Math.max(0, 100 - 9 * (-dev - 0.015) * 100);
    if (dev > 0.03) return Math.max(0, 100 - 5 * (dev - 0.03) * 100);
    return 100;
  }
  function hrRepScore(end, band, lthr) {
    if (!isNum(end)) return NaN;
    let s = 100;
    if (end > band.hi + 3) s -= 5 * (end - band.hi - 3);
    else if (end < band.lo - 6) s -= 2.5 * (band.lo - 6 - end);
    if (end > lthr + 3) s -= 5 * (end - lthr - 3);
    return clamp(s, 0, 100);
  }
  function verdictFor(score) {
    if (score >= 90) return { label: 'Textbook sub-threshold', tone: 'great' };
    if (score >= 80) return { label: 'Well executed', tone: 'good' };
    if (score >= 70) return { label: 'Solid, a few tweaks', tone: 'ok' };
    if (score >= 55) return { label: 'Off target in places', tone: 'warn' };
    return { label: 'Well off target', tone: 'bad' };
  }

  /* ------------------------- main analysis ------------------------------ */
  function analyze(raw, model, opts) {
    opts = opts || {};
    const unit = opts.unit || 'km';
    const P = (s) => NSA.fmtPace(s, unit) + NSA.paceUnitLabel(unit);
    const w = prepare(raw);
    const hrp = model.hr, fit = model.fit;
    const lthr = hrp.lthr;
    const findings = [], suggestions = [];
    const add = (type, text) => findings.push({ type, text });

    // ----- detection
    let det = null, method = 'speed', lapInfo = null, strides = [];
    const force = opts.force || 'auto'; // auto | intervals | easy
    if (force !== 'easy' && opts.detect !== 'speed') {
      const lp = segmentsFromLaps(raw, w);
      if (lp) { det = { segs: lp.segs, T: NaN }; method = 'laps'; lapInfo = lp; }
    }
    let speedInfo = null;
    if (!det && force !== 'easy') {
      speedInfo = segmentsFromSpeed(w, opts.sensitivity || 0);
      if (speedInfo && speedInfo.sepRatio >= 1.08) {
        const pm = pickMainSets(speedInfo.segs); strides = pm.dropped;
        det = { segs: pm.reps, T: speedInfo.T };
      }
    }
    let workSegs = det ? det.segs : [];
    if (workSegs.length < 2 && !(method === 'laps' && workSegs.length >= 1)) workSegs = [];
    const mode = workSegs.length >= 2 ? 'intervals' : 'easy';

    // ----- totals
    let firstMove = 0; while (firstMove < w.N - 1 && w.v15[firstMove] < 0.8) firstMove++;
    let lastMove = w.N - 1; while (lastMove > firstMove && w.v15[lastMove] < 0.8) lastMove--;
    let movingSec = 0; for (let i = 0; i < w.N; i++) if (w.v5[i] > 0.8) movingSec++;
    const totals = {
      durSec: w.N, movingSec, distM: w.dist[w.N - 1], avgHr: sliceMean(w.hr, 0, w.N),
      maxHr: (() => { let m = NaN; for (const x of w.hr) if (isNum(x) && !(m >= x)) m = x; return m; })(),
      startMs: raw.startMs, name: raw.name || raw.fileName || 'Workout', sport: raw.sport || '', format: raw.format,
      hasHr: w.hasHr, hasAlt: w.hasAlt,
      avgPace: (w.dist[w.N - 1] > 100) ? movingSec / (w.dist[w.N - 1] / 1000) : NaN,
    };
    const A = { mode, unit, method, totals, findings, suggestions, strides: strides.length, sensitivity: opts.sensitivity || 0,
      detect: { T: det && det.T, c1: speedInfo && speedInfo.c1, c2: speedInfo && speedInfo.c2 }, lapInfo };

    // series for charts (every 3 s)
    A.series = [];
    for (let i = 0; i < w.N; i += 3) A.series.push({ t: i, v: w.v15[i], hr: isNum(w.hr[i]) ? w.hr[i] : null, alt: isNum(w.alt[i]) ? w.alt[i] : null });

    const parts = [];
    if (mode === 'intervals') {
      /* ---------- reps ---------- */
      const n = workSegs.length;
      const reps = workSegs.map(([a, b], i) => {
        const m = segMetrics(w, a, b);
        const target = NSA.repPace(fit, m.dur);
        m.target = target;
        const usePace = opts.gradeAdjust === false ? m.pace : m.adjPace;
        m.dev = (usePace - target) / target;
        m.paceScore = paceScore(m.dev);
        m.avgBand = NSA.avgHrBand(lthr, i, n, m.dur);
        m.endBand = NSA.endHrBand(lthr, i, n);
        m.hrScore = w.hasHr ? hrRepScore(m.endHr, m.endBand, lthr) : NaN;
        m.idx = i + 1;
        return m;
      });
      A.reps = reps;
      /* ---------- rests ---------- */
      const rests = [];
      for (let i = 0; i < n - 1; i++) {
        const a = reps[i].b, b = reps[i + 1].a;
        if (b - a < 3) continue;
        const m = segMetrics(w, a, b);
        const win = NSA.restWindow(reps[i].dur);
        m.win = win; m.idx = i + 1;
        m.hrStart = sliceMean(w.hr, a, a + 5); m.hrEnd = sliceMean(w.hr, b - 5, b);
        m.hrDrop = isNum(m.hrStart) && isNum(m.hrEnd) ? m.hrStart - m.hrEnd : NaN;
        m.broken = b - a > 330;
        if (m.dur < win.lo * 0.85) m.score = Math.max(0, 100 - 0.5 * (win.lo * 0.85 - m.dur));
        else if (m.dur > win.hi * 1.15) m.score = Math.max(0, 100 - 0.35 * (m.dur - win.hi * 1.15));
        else m.score = 100;
        rests.push(m);
      }
      A.rests = rests;
      const innerRests = rests.filter((r) => !r.broken);

      /* ---------- warm-up / cool-down ---------- */
      const first = reps[0].a, last = reps[n - 1].b;
      const wuSec = lapInfo && lapInfo.warmupSec ? lapInfo.warmupSec : Math.max(0, first - firstMove);
      const trail = lapInfo ? lapInfo.trailingRest : 0;
      const cdStart = last + trail;
      const cdSec = lapInfo && lapInfo.cooldownSec ? lapInfo.cooldownSec : Math.max(0, lastMove - cdStart);
      A.warmup = { dur: wuSec, hr: sliceMean(w.hr, firstMove, first), dist: w.dist[first] - w.dist[firstMove] };
      A.cooldown = { dur: cdSec, hr: sliceMean(w.hr, cdStart, lastMove), dist: w.dist[Math.min(w.N - 1, lastMove)] - w.dist[Math.min(w.N - 1, cdStart)], trailingRest: trail };
      A.warmup.pace = A.warmup.dist > 50 ? A.warmup.dur / (A.warmup.dist / 1000) : NaN;
      A.cooldown.pace = A.cooldown.dist > 50 ? A.cooldown.dur / (A.cooldown.dist / 1000) : NaN;

      /* ---------- set summary ---------- */
      const workSec = reps.reduce((s, r) => s + r.dur, 0);
      const workDist = reps.reduce((s, r) => s + r.dist, 0);
      A.set = {
        n, workSec, workDist, avgPace: workSec / (workDist / 1000), avgHr: mean(reps.map((r) => r.hrAvg)),
        restSec: rests.reduce((s, r) => s + r.dur, 0), restCount: rests.length + (trail ? 1 : 0),
        durs: reps.map((r) => r.dur), uniform: (() => { const med = median(reps.map((r) => r.dur)); return reps.every((r) => Math.abs(r.dur - med) <= Math.max(15, 0.15 * med)); })(),
        medDur: median(reps.map((r) => r.dur)),
      };
      A.set.label = A.set.uniform ? describeUniform(n, A.set.medDur) : 'Custom set: ' + reps.map((r) => fmtDur(r.dur)).join(' · ');

      /* ---------- component scores ---------- */
      const ps = mean(reps.map((r) => r.paceScore));
      const meanDev = mean(reps.map((r) => r.dev));
      parts.push({ id: 'pace', label: 'Pace vs target', weight: 35, score: ps,
        note: (meanDev >= 0 ? '+' : '') + (meanDev * 100).toFixed(1) + '% vs target on average' });
      if (w.hasHr) {
        const hs = mean(reps.map((r) => r.hrScore));
        const over = reps.filter((r) => r.endHr > lthr + 3).length;
        parts.push({ id: 'hr', label: 'Heart-rate control', weight: 25, score: hs, note: over ? over + ' rep(s) finished above LTHR' : 'End-of-rep HR progression vs LTHR ' + lthr });
      }
      if (n >= 2) {
        const devs = reps.map((r) => r.dev * 100);
        const s_ = sd(devs);
        const k = Math.max(1, Math.floor(n / 3));
        const fade = mean(devs.slice(-k)) - mean(devs.slice(0, k));
        let cs = 100 - 12 * s_;
        if (fade > 2) cs -= 5 * (fade - 2);
        A.consistency = { sd: s_, fade };
        parts.push({ id: 'cons', label: 'Consistency', weight: 20, score: clamp(cs, 0, 100), note: 'rep-to-rep spread ±' + s_.toFixed(1) + '%, ' + (fade > 0.5 ? 'fade ' + fade.toFixed(1) + '%' : fade < -0.5 ? 'got faster ' + (-fade).toFixed(1) + '%' : 'steady') });
      }
      if (innerRests.length) {
        const rs = mean(innerRests.map((r) => r.score));
        parts.push({ id: 'rest', label: 'Recoveries', weight: 10, score: rs, note: innerRests.length + ' rests, avg ' + Math.round(mean(innerRests.map((r) => r.dur))) + ' s' });
      }
      {
        const wuS = clamp(wuSec / 600, 0, 1) * 100, cdS = clamp(cdSec / 420, 0, 1) * 100;
        const q = workSec / 60;
        let volS = q >= 24 && q <= 40 ? 100 : q < 24 ? clamp(30 + (q - 8) / 16 * 70, 20, 100) : clamp(100 - (q - 40) * 3, 50, 100);
        let wuHrPenalty = 0;
        if (isNum(A.warmup.hr) && A.warmup.hr > hrp.easyStretch) wuHrPenalty = Math.min(25, (A.warmup.hr - hrp.easyStretch) * 2);
        const ss = clamp(0.35 * wuS + 0.25 * cdS + 0.4 * volS - wuHrPenalty, 0, 100);
        A.structure = { wuS, cdS, volS, quality: q };
        parts.push({ id: 'struct', label: 'Session structure', weight: 10, score: ss, note: `WU ${Math.round(wuSec / 60)} min · ${Math.round(q)} min of work · CD ${Math.round(cdSec / 60)} min` });
      }

      /* ---------- findings & suggestions ---------- */
      narrateIntervals(A, { P, lthr, hrp, fit, unit, add, suggestions, parts, w, opts });
    } else {
      /* ---------- easy / steady run ---------- */
      const a0 = firstMove, b0 = lastMove;
      const hrAvg = sliceMean(w.hr, a0, b0), movePace = totals.avgPace;
      let above = 0, cnt = 0; for (let i = a0; i <= b0; i++) if (isNum(w.hr[i]) && w.v5[i] > 0.8) { cnt++; if (w.hr[i] > hrp.easyCap) above++; }
      const fracAbove = cnt ? above / cnt : NaN;
      // decoupling: compare speed/HR first vs second half (skip first 10 %)
      const s0 = a0 + Math.floor((b0 - a0) * 0.1), mid = Math.floor((s0 + b0) / 2);
      const ef = (a, b) => { const v = (w.dist[b] - w.dist[a]) / (b - a); const h = sliceMean(w.hr, a, b); return v / h; };
      const drift = w.hasHr && b0 - a0 > 1200 ? (ef(s0, mid) - ef(mid, b0)) / ef(s0, mid) * 100 : NaN;
      A.easy = { hrAvg, movePace, fracAbove, drift, dur: b0 - a0, dist: w.dist[b0] - w.dist[a0] };
      if (w.hasHr) {
        let hs;
        if (hrAvg <= hrp.easyCap) hs = 100; else if (hrAvg <= hrp.easyStretch) hs = 100 - 30 * (hrAvg - hrp.easyCap) / Math.max(1, hrp.easyStretch - hrp.easyCap);
        else hs = Math.max(0, 70 - 4 * (hrAvg - hrp.easyStretch));
        parts.push({ id: 'ehr', label: 'Average HR vs easy cap', weight: 45, score: hs, note: `avg ${Math.round(hrAvg)} bpm vs cap ${hrp.easyCap}` });
        parts.push({ id: 'etime', label: 'Time above easy cap', weight: 20, score: clamp(100 - 150 * (fracAbove || 0), 0, 100), note: Math.round((fracAbove || 0) * 100) + '% of moving time' });
        if (isNum(drift)) parts.push({ id: 'edrift', label: 'Cardiac drift', weight: 10, score: clamp(100 - Math.max(0, drift - 5) * 10, 0, 100), note: drift.toFixed(1) + '% pace:HR decoupling' });
      }
      const fastLimit = fit.easy.fast;
      const ratio = (fastLimit - movePace) / fastLimit; // + if faster than limit
      parts.push({ id: 'epace', label: 'Pace in easy range', weight: 25, score: ratio > 0 ? clamp(100 - ratio * 100 * 6, 0, 100) : 100, note: `avg ${P(movePace)} vs easy ${P(fit.easy.fast)}–${P(fit.easy.slow)}` });
      narrateEasy(A, { P, lthr, hrp, fit, add, suggestions, w, strideCount: strides.length, forced: force, speedInfo });
    }

    // ----- total
    let wsum = 0, ssum = 0; for (const p of parts) if (isNum(p.score)) { wsum += p.weight; ssum += p.weight * p.score; }
    let total = wsum ? Math.round(ssum / wsum) : NaN;
    // pace is the heart of the method: a session far from target can't score well on the strength of other parts
    const pp = parts.find((p) => p.id === 'pace');
    if (pp && isNum(total)) total = Math.min(total, Math.round(pp.score) + 20);
    parts.forEach((p) => { p.score = Math.round(p.score); p.eff = wsum ? Math.round(p.weight / wsum * 100) : 0; });
    A.scores = { total, parts };
    A.verdict = verdictFor(total);
    if (mode === 'easy') A.verdict = (() => { const v = verdictFor(total); return { label: total >= 90 ? 'Properly easy' : total >= 80 ? 'Mostly easy' : total >= 70 ? 'A bit too firm' : total >= 55 ? 'Too hard for an easy day' : 'Not easy at all', tone: v.tone }; })();
    // order findings by severity
    const rank = { bad: 0, warn: 1, info: 2, good: 3 };
    findings.sort((x, y) => rank[x.type] - rank[y.type]);
    return A;
  }

  function fmtDur(s) { const r5 = Math.round(s / 5) * 5; s = Math.abs(s - r5) <= 2.5 ? r5 : Math.round(s); return s % 60 === 0 && s >= 60 ? (s / 60) + ' min' : s < 60 ? s + ' s' : Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  function describeUniform(n, dur) {
    const m = Math.round(dur / 5) * 5 / 60; const r = Math.round(m * 2) / 2;
    if (Math.abs(m - r) < 0.17) return `${n} × ${r % 1 === 0 ? r : r.toFixed(1)} min`;
    return `${n} × ${fmtDur(dur)}`;
  }

  /* ------------------------- narrative rules ---------------------------- */
  function narrateIntervals(A, c) {
    const { P, lthr, hrp, fit, add, w, opts } = c;
    const reps = A.reps, n = reps.length;
    const devs = reps.map((r) => r.dev), md = mean(devs);
    const sign = (x) => (x > 0 ? '+' : '') + (x * 100).toFixed(1) + '%';
    const avgTarget = mean(reps.map((r) => r.target));
    // pace
    if (md < -0.03) {
      add('bad', `Reps averaged ${P(mean(reps.map((r) => r.adjPace)))} — ${(-md * 100).toFixed(1)}% faster than the sub-threshold target (${P(avgTarget)}). That’s drifting toward threshold/VO₂ work.`);
      c.suggestions.push(`Hold back: aim for ${P(avgTarget * 1.0)}–${P(avgTarget * 1.03)} and let the later reps feel almost too easy early on.`);
    } else if (md < -0.015) {
      add('warn', `Reps were ${(-md * 100).toFixed(1)}% quicker than target on average (${P(mean(reps.map((r) => r.adjPace)))} vs ${P(avgTarget)}) — slightly hot.`);
      c.suggestions.push(`Nudge pace down by ~${Math.round(-md * avgTarget)} s${NSA.paceUnitLabel(c.unit)} so the last rep still has one or two reps left in it.`);
    } else if (md > 0.06) {
      add('warn', `Reps averaged ${(md * 100).toFixed(1)}% slower than target (${P(mean(reps.map((r) => r.adjPace)))} vs ${P(avgTarget)}) — well under sub-threshold stimulus.`);
      c.suggestions.push('If HR was also low, your race-based paces may be stale: run a fresh 5K/parkrun or 30-min time trial and update the Inputs page.');
    } else if (md > 0.03) {
      add('info', `Reps were a touch conservative (${sign(md)} vs target). Fine when you’re building or it’s hot; aim for the target as you settle in.`);
    } else {
      add('good', `Pace on target: ${P(mean(reps.map((r) => r.adjPace)))} average vs ${P(avgTarget)} prescribed (${sign(md)}).`);
    }
    // grade adjust
    if (w.hasAlt && opts.gradeAdjust !== false) {
      const big = reps.filter((r) => isNum(r.net) && Math.abs(r.net) >= 3 && Math.abs(r.adjPace - r.pace) / r.pace > 0.01);
      if (big.length) add('info', `Hills affected ${big.length} rep(s); pace was grade-adjusted to the equivalent flat effort before scoring.`);
    }
    // HR
    if (w.hasHr) {
      const over = reps.filter((r) => r.endHr > lthr + 3);
      const lastEnd = reps[n - 1].endHr, firstEnd = reps[0].endHr;
      const peak = Math.max(...reps.map((r) => r.hrMax).filter(isNum));
      if (over.length) {
        add('bad', `Rep${over.length > 1 ? 's' : ''} ${over.map((r) => r.idx).join(', ')} finished above your LTHR (${lthr} bpm): ${over.map((r) => Math.round(r.endHr)).join(', ')} bpm. Sub-threshold work should approach LTHR from below, not cross it.`);
        c.suggestions.push(`Slow the first rep by 5–10 s${NSA.paceUnitLabel(c.unit)} and cap end-of-rep HR at ~${lthr} bpm; if you still cross LTHR late in the set, drop a rep rather than speed up.`);
      } else if (isNum(lastEnd) && lastEnd <= lthr + 3) {
        add('good', `HR stayed under LTHR: reps finished ${Math.round(firstEnd)} → ${Math.round(lastEnd)} bpm (max ${Math.round(peak)}).`);
      }
      if (isNum(firstEnd) && firstEnd < lthr - 20 && md > -0.01) add('info', `Rep 1 finished at ${Math.round(firstEnd)} bpm — ${Math.round(lthr - firstEnd)} below LTHR. Early reps normally land 10–15 bpm below; this one is very comfortable (heat, HR lag or conservative start).`);
      if (n >= 4) {
        const drift = (reps[n - 1].endHr - reps[0].endHr);
        if (isNum(drift) && drift > 18) add('warn', `HR climbed ${Math.round(drift)} bpm from first to last rep — more cardiac drift than the typical 10–15 bpm; consider shorter volume or slower early reps.`);
      }
    } else {
      add('info', 'No heart-rate data in this file — HR scoring skipped. Pair a chest strap or optical sensor to unlock LTHR-based feedback.');
    }
    // consistency
    if (A.consistency) {
      if (A.consistency.fade > 3) { add('warn', `Pacing faded by ${A.consistency.fade.toFixed(1)}% from the first to the last third of reps — started too hot.`); c.suggestions.push('Open the first two reps ~3–5 s slower than the average you want; first and last rep should look almost identical.'); }
      else if (A.consistency.sd < 1.5) add('good', `Very even execution: rep-to-rep spread only ±${A.consistency.sd.toFixed(1)}%.`);
      else if (A.consistency.sd > 3) add('warn', `Uneven reps (±${A.consistency.sd.toFixed(1)}% spread) — look for terrain, traffic or surging.`);
    }
    // rests
    const inner = A.rests.filter((r) => !r.broken);
    if (inner.length) {
      const longR = inner.filter((r) => r.dur > r.win.hi * 1.15), shortR = inner.filter((r) => r.dur < r.win.lo * 0.85);
      const avgR = mean(inner.map((r) => r.dur));
      if (!A.set.uniform) { const mw = NSA.restWindow(A.set.medDur); inner[0] = Object.assign({}, inner[0], { win: mw }); }
      if (longR.length > inner.length / 2) { add('warn', `Recoveries averaged ${Math.round(avgR)} s; for ${fmtDur(A.set.medDur)} reps the target window is ${inner[0].win.lo}–${inner[0].win.hi} s. Long rests let lactate fall and defeat the point of short-rest sub-threshold work.`); c.suggestions.push(`Tighten recoveries to ${inner[0].win.lo}–${inner[0].win.hi} s of easy jog/walk — and if you can’t, the reps were too fast.`); }
      else if (shortR.length > inner.length / 2) { add('info', `Recoveries were short (${Math.round(avgR)} s vs ${inner[0].win.lo}–${inner[0].win.hi} s). Shortening rest isn’t a progression target in the Singles method — keep it ≥ ${inner[0].win.lo} s.`); }
      else add('good', `Recoveries on plan: ${Math.round(avgR)} s on average (window ${inner[0].win.lo}–${inner[0].win.hi} s).`);
      const nRest = A.set.restCount;
      if (A.method === 'laps' && A.lapInfo && A.lapInfo.trailingRest) add('info', `Detected ${n} reps with ${nRest} rest intervals (including the rest after the final rep) from your workout steps.`);
    }
    // structure
    const wu = A.warmup, cd = A.cooldown;
    if (wu.dur < 420) { add('warn', `Warm-up was only ${Math.round(wu.dur / 60)} min — aim for ~10 min easy (plus a few strides if you like) before rep 1.`); }
    else add('good', `Warm-up ${Math.round(wu.dur / 60)} min` + (isNum(wu.hr) ? ` at ${Math.round(wu.hr)} bpm.` : '.'));
    if (cd.dur < 240) add('info', `Cool-down was short (${Math.round(cd.dur / 60)} min); 7–10 min easy jog helps recovery.`);
    if (isNum(wu.hr) && wu.hr > hrp.easyStretch) add('warn', `Warm-up HR averaged ${Math.round(wu.hr)} bpm (above ${hrp.easyStretch}) — start easier so the first rep isn’t pre-fatigued.`);
    const q = A.structure.quality;
    if (q < 18) c.suggestions.push(`Quality volume was ${Math.round(q)} min of work. Singles sessions typically run 24–36 min of reps; add one 3-min rep (or 6-min rep) if recovery has been good.`);
    else if (q > 42) add('warn', `${Math.round(q)} min of work is on the high side for a single session; keep total sub-threshold ≈ 20–25% of weekly time.`);
    else add('info', `${Math.round(q)} min of sub-threshold work — in the typical 24–36 min range.`);
    if (A.strides) add('info', `${A.strides} short pick-up/stride effort(s) before or after the main set were ignored in the score.`);
    if (!c.suggestions.length) c.suggestions.push('Repeat this session next week at the same paces; progress by adding one rep (or +1 min total) every 1–2 weeks once it feels easy.');
    c.suggestions.push(`Recheck paces with a race or time trial every 4–8 weeks (current model: VDOT ${fit.vdot.toFixed(1)}, 5K ≈ ${NSA.fmtTime(fit.t5k)}).`);
  }
  function narrateEasy(A, c) {
    const { P, hrp, fit, add, w } = c;
    const e = A.easy;
    add('info', 'No structured intervals were detected, so this was scored as an easy/steady run' + (c.forced === 'easy' ? ' (forced).' : '. If it was a session, try the sensitivity slider or force “Intervals”.'));
    if (w.hasHr) {
      if (e.hrAvg <= hrp.easyCap) add('good', `Average HR ${Math.round(e.hrAvg)} bpm is under your easy cap (${hrp.easyCap} bpm ≈ 70% of ${hrp.hrMax}${hrp.hrMaxEstimated ? ' est.' : ''} max).`);
      else if (e.hrAvg <= hrp.easyStretch) add('warn', `Average HR ${Math.round(e.hrAvg)} bpm is above the easy cap of ${hrp.easyCap} but below ${hrp.easyStretch} (85% LTHR) — a firm aerobic run rather than truly easy.`);
      else add('bad', `Average HR ${Math.round(e.hrAvg)} bpm is above 85% of LTHR (${hrp.easyStretch}) — that’s tempo territory, not an easy day.`);
      if (isNum(e.fracAbove) && e.fracAbove > 0.25) add('warn', `${Math.round(e.fracAbove * 100)}% of the run was above the easy HR cap — walk the hills or slow down to keep it capped.`);
      if (isNum(e.drift) && e.drift > 7) add('info', `Pace:HR decoupling of ${e.drift.toFixed(1)}% suggests drift (heat, hydration or too fast a start).`);
    }
    if (e.movePace < fit.easy.fast * 0.97) { add('warn', `Average pace ${P(e.movePace)} is faster than the easy range (${P(fit.easy.fast)}–${P(fit.easy.slow)}).`); c.suggestions.push(`Ease off to ~${P(fit.easy.fast)}–${P(fit.easy.slow)} or slower; on easy days HR rules over pace.`); }
    else add('good', `Pace ${P(e.movePace)} sits within or slower than your easy range (${P(fit.easy.fast)}–${P(fit.easy.slow)}).`);
    c.suggestions.push('Easy days make the sub-threshold days repeatable — keep the long run easy too.');
  }

  NSA.analyzeWorkout = analyze;
  NSA.analyzeUtil = { prepare, segmentsFromSpeed, twoMeans, mean, median, sd, fmtDur, describeUniform };
})(typeof window !== 'undefined' ? window : globalThis);
