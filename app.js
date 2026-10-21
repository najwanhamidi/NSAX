/* NSA core: Norwegian Singles Approach pace + heart-rate model
 *
 * Sources used to build the model (see README "Method & sources"):
 *  - norwegiansingles.run  (Norwegian Singles guide): rep table 3 min ~12-15K pace, 6 min ~20K/HM pace,
 *    10 min ~25-30K pace; recoveries 60 s / 60-90 s / 90-120 s; early reps finish ~10-15 bpm below LTHR;
 *    easy runs average HR <= ~70% of max HR; sub-threshold work ~20-25% of weekly running time.
 *  - James Copeland / Norwegian Singles Method: 5K-based pace table (3/6/10 min reps + easy pace).
 *  - Jack Daniels VDOT equations for race-time equivalence.
 */
(function (root) {
  const NSA = root.NSA = root.NSA || {};

  /* ------------------------------------------------------------------ */
  /* formatting helpers                                                  */
  /* ------------------------------------------------------------------ */
  const KM_PER_MI = 1.609344;

  function fmtTime(sec, opts) {
    opts = opts || {};
    if (!isFinite(sec)) return '–';
    sec = Math.round(sec);
    const neg = sec < 0; sec = Math.abs(sec);
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    const pad = (n) => String(n).padStart(2, '0');
    let out;
    if (h > 0) out = h + ':' + pad(m) + ':' + pad(s);
    else out = (opts.padMin ? pad(m) : m) + ':' + pad(s);
    return (neg ? '-' : '') + out;
  }
  // pace in sec/km -> "m:ss" in chosen unit (km|mi)
  function fmtPace(secPerKm, unit) {
    if (!isFinite(secPerKm) || secPerKm <= 0) return '–';
    const v = unit === 'mi' ? secPerKm * KM_PER_MI : secPerKm;
    let m = Math.floor(v / 60), s = Math.round(v - m * 60);
    if (s === 60) { m += 1; s = 0; }
    return m + ':' + String(s).padStart(2, '0');
  }
  function paceUnitLabel(unit) { return unit === 'mi' ? '/mi' : '/km'; }
  function parseTime(str) {
    if (str == null) return NaN;
    str = String(str).trim().replace(',', '.');
    if (!str) return NaN;
    const parts = str.split(':').map(Number);
    if (parts.some((x) => !isFinite(x) || x < 0)) return NaN;
    if (parts.length === 1) return parts[0] * 60;       // bare number = minutes
    if (parts.length === 2) return parts[0] * 60 + parts[1]; // m:ss
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return NaN;
  }
  // parse a pace string "m:ss" entered in unit -> sec/km
  function parsePace(str, unit) {
    const t = parseTime(str);
    if (!isFinite(t)) return NaN;
    return unit === 'mi' ? t / KM_PER_MI : t;
  }

  /* ------------------------------------------------------------------ */
  /* VDOT (Daniels/Gilbert) equivalence                                  */
  /* ------------------------------------------------------------------ */
  function vdotFromRace(distM, timeSec) {
    const t = timeSec / 60, v = distM / t;
    const vo2 = -4.60 + 0.182258 * v + 0.000104 * v * v;
    const pct = 0.8 + 0.1894393 * Math.exp(-0.012778 * t) + 0.2989558 * Math.exp(-0.1932605 * t);
    return vo2 / pct;
  }
  function raceTimeForVdot(vdot, distM) {
    let lo = distM / 600 * 60 * 0.3, hi = distM / 60 * 60 * 3; // seconds, generous bracket
    lo = Math.max(30, distM / 8.5); hi = distM / 1.2;           // 8.5 m/s .. 1.2 m/s
    for (let i = 0; i < 80; i++) {
      const mid = (lo + hi) / 2;
      if (vdotFromRace(distM, mid) > vdot) lo = mid; else hi = mid; // faster time -> higher vdot
    }
    return (lo + hi) / 2;
  }

  const RACES = [
    { id: '1500', label: '1500 m', m: 1500 },
    { id: '1mi', label: '1 mile', m: 1609.344 },
    { id: '3k', label: '3 km', m: 3000 },
    { id: '3mi', label: '2 miles', m: 3218.688 },
    { id: '5k', label: '5 km / parkrun', m: 5000 },
    { id: '8k', label: '8 km', m: 8000 },
    { id: '10k', label: '10 km', m: 10000 },
    { id: '15k', label: '15 km', m: 15000 },
    { id: '10mi', label: '10 miles', m: 16093.44 },
    { id: '20k', label: '20 km', m: 20000 },
    { id: 'hm', label: 'Half marathon', m: 21097.5 },
    { id: '25k', label: '25 km', m: 25000 },
    { id: '30k', label: '30 km', m: 30000 },
    { id: 'mar', label: 'Marathon', m: 42195 },
    { id: 'custom', label: 'Custom distance…', m: 0 },
  ];
  function raceMeters(race) {
    if (race.id === 'custom') return (race.customKm || 0) * 1000;
    const r = RACES.find((x) => x.id === race.id);
    return r ? r.m : 0;
  }

  /* ------------------------------------------------------------------ */
  /* Copeland 5K-based table (sec/km), see source in README              */
  /* ------------------------------------------------------------------ */
  // 5K time (sec) -> pace sec/km for 3-, 6-, 10-min reps and easy
  const COPELAND = [
    [900, 193, 198, 205, 256],
    [960, 205, 211, 217, 274],
    [1080, 230, 236, 243, 308],
    [1200, 254, 260, 269, 343],
    [1320, 278, 285, 294, 378],
    [1440, 302, 310, 319, 412],
    [1560, 326, 334, 344, 446],
    [1680, 349, 358, 369, 480],
    [1800, 373, 382, 394, 514],
  ];
  function interp(x, xs, ys) {
    if (x <= xs[0]) { // linear extrapolation with end slope
      const s = (ys[1] - ys[0]) / (xs[1] - xs[0]); return ys[0] + s * (x - xs[0]);
    }
    const n = xs.length;
    if (x >= xs[n - 1]) { const s = (ys[n - 1] - ys[n - 2]) / (xs[n - 1] - xs[n - 2]); return ys[n - 1] + s * (x - xs[n - 1]); }
    for (let i = 0; i < n - 1; i++) if (x <= xs[i + 1]) {
      const f = (x - xs[i]) / (xs[i + 1] - xs[i]); return ys[i] + f * (ys[i + 1] - ys[i]);
    }
    return ys[n - 1];
  }
  function copelandAnchors(t5k) {
    const xs = COPELAND.map((r) => r[0]);
    return {
      p3: interp(t5k, xs, COPELAND.map((r) => r[1])),
      p6: interp(t5k, xs, COPELAND.map((r) => r[2])),
      p10: interp(t5k, xs, COPELAND.map((r) => r[3])),
      easy: interp(t5k, xs, COPELAND.map((r) => r[4])),
    };
  }

  /* ------------------------------------------------------------------ */
  /* Rep-pace model: any rep duration -> pace                            */
  /* ------------------------------------------------------------------ */
  // Guide anchors: duration(s) -> equivalent race distance (km)
  //   3 min ~ 12-15K (13.5), 6 min ~ 20K/HM (20.5), 10 min ~ 25-30K (27.5)
  const ANCHORS = [[180, 13.5], [360, 20.5], [600, 27.5]];
  const EXP_EXTRAP = 0.59;      // d ~ t^0.59 beyond the anchors
  const MIN_EQ_KM = 10;         // reps never faster than 10K pace (guide)
  const MAX_EQ_KM = 42.195;     // reps never slower than marathon pace

  function eqDistanceKm(durSec) {
    const A = ANCHORS;
    let d;
    if (durSec <= A[0][0]) d = A[0][1] * Math.pow(durSec / A[0][0], EXP_EXTRAP);
    else if (durSec >= A[2][0]) d = A[2][1] * Math.pow(durSec / A[2][0], EXP_EXTRAP);
    else {
      const i = durSec <= A[1][0] ? 0 : 1;
      const b = Math.log(A[i + 1][1] / A[i][1]) / Math.log(A[i + 1][0] / A[i][0]);
      d = A[i][1] * Math.pow(durSec / A[i][0], b);
    }
    return Math.min(MAX_EQ_KM, Math.max(MIN_EQ_KM, d));
  }

  // Build a "fitness" object from a VDOT value
  function fitnessFromVdot(vdot, method) {
    const t5k = raceTimeForVdot(vdot, 5000);
    const cop = copelandAnchors(t5k);
    const fit = { vdot, t5k, method: method || 'blend', cop };
    fit.p5k = t5k / 5;
    // threshold ~ pace you could hold for ~60 min
    fit.thresholdPace = (function () {
      // distance covered in 3600 s at this vdot
      let lo = 5000, hi = 25000;
      for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (raceTimeForVdot(vdot, mid) < 3600) lo = mid; else hi = mid; }
      return 3600 / ((lo + hi) / 2 / 1000);
    })();
    fit.easy = {
      slow: cop.easy,                 // Copeland table easy pace = slow end
      fast: fit.p5k * 1.29,           // Daniels-style easy upper bound
    };
    return fit;
  }

  function guidePace(fit, durSec) {
    const dKm = eqDistanceKm(durSec);
    return raceTimeForVdot(fit.vdot, dKm * 1000) / dKm;
  }
  function copelandPace(fit, durSec) {
    const c = fit.cop;
    // interpolate in log(duration) between anchors; extrapolate with end slopes, clamp to [10K .. marathon] pace
    const xs = [Math.log(180), Math.log(360), Math.log(600)];
    const ys = [c.p3, c.p6, c.p10];
    const x = Math.log(Math.max(30, durSec));
    let p;
    if (x <= xs[0]) { const s = (ys[1] - ys[0]) / (xs[1] - xs[0]); p = ys[0] + s * (x - xs[0]); }
    else if (x >= xs[2]) { const s = (ys[2] - ys[1]) / (xs[2] - xs[1]); p = ys[2] + s * (x - xs[2]); }
    else if (x <= xs[1]) p = ys[0] + (ys[1] - ys[0]) * (x - xs[0]) / (xs[1] - xs[0]);
    else p = ys[1] + (ys[2] - ys[1]) * (x - xs[1]) / (xs[2] - xs[1]);
    const fastLimit = raceTimeForVdot(fit.vdot, 10000) / 10, slowLimit = raceTimeForVdot(fit.vdot, 42195) / 42.195;
    return Math.min(slowLimit, Math.max(fastLimit, p));
  }
  // main entry: pace (sec/km) for a rep of given duration
  function repPace(fit, durSec) {
    const g = guidePace(fit, durSec), c = copelandPace(fit, durSec);
    switch (fit.method) {
      case 'guide': return g;
      case 'copeland': return c;
      default: return (g + c) / 2;
    }
  }
  // Duration for a rep of given distance (iterate: time depends on pace depends on time)
  function repForDistance(fit, distM) {
    let t = distM / 1000 * 270;
    for (let i = 0; i < 30; i++) { const p = repPace(fit, t); const nt = p * distM / 1000; if (Math.abs(nt - t) < 0.05) { t = nt; break; } t = nt; }
    return { durSec: t, pace: repPace(fit, t) };
  }

  // Recommended recovery window (sec) for a rep duration
  function restWindow(durSec) {
    const pts = [[60, 30, 45], [180, 50, 75], [360, 60, 90], [600, 90, 120], [1200, 120, 180]];
    const xs = pts.map((p) => p[0]);
    return { lo: Math.round(interp(Math.min(1200, Math.max(60, durSec)), xs, pts.map((p) => p[1]))),
             hi: Math.round(interp(Math.min(1200, Math.max(60, durSec)), xs, pts.map((p) => p[2]))) };
  }

  /* ------------------------------------------------------------------ */
  /* Heart-rate model from LTHR                                          */
  /* ------------------------------------------------------------------ */
  function estimateHrMax(lthr) { return Math.round(lthr / 0.91); } // LTHR is typically ~88-93% of HRmax in trained runners

  function hrProfile(lthr, hrMaxIn) {
    const hrMax = hrMaxIn && hrMaxIn > lthr ? hrMaxIn : estimateHrMax(lthr);
    return {
      lthr, hrMax, hrMaxEstimated: !(hrMaxIn && hrMaxIn > lthr),
      easyCap: Math.round(0.70 * hrMax),          // guide: avg HR <= ~70% of max HR on easy / long runs
      easyStretch: Math.round(0.85 * lthr),       // Friel Z1 ceiling: soft limit (warm weather / long run end)
    };
  }
  // Expected HR during a rep (sub-threshold pattern: early reps finish 10-15 bpm below LTHR, later reps approach LTHR from below)
  function lagBpm(durSec) { return Math.max(2, 10 - 0.7 * durSec / 60); }
  function endHrBand(lthr, i, n) { // i is 0-based rep index
    const u = n > 1 ? i / (n - 1) : 1;
    return { lo: lthr - 15 + 10 * u, hi: lthr - 10 + 10 * u };
  }
  function avgHrBand(lthr, i, n, durSec) {
    const b = endHrBand(lthr, i, n), lag = lagBpm(durSec);
    return { lo: b.lo - lag, hi: b.hi - lag };
  }

  // 5-zone running model (Friel, % of LTHR) shown for reference
  function lthrZones(lthr) {
    const z = (a, b) => [Math.round(lthr * a), b == null ? null : Math.round(lthr * b)];
    return [
      { id: 'Z1', name: 'Recovery', range: [null, Math.round(lthr * 0.85) - 1], pct: '<85%' },
      { id: 'Z2', name: 'Aerobic', range: z(0.85, 0.89), pct: '85–89%' },
      { id: 'Z3', name: 'Tempo', range: z(0.90, 0.94), pct: '90–94%' },
      { id: 'Z4', name: 'Sub-threshold', range: z(0.95, 0.99), pct: '95–99%' },
      { id: 'Z5a', name: 'Threshold', range: z(1.00, 1.02), pct: '100–102%' },
      { id: 'Z5b', name: 'VO₂max', range: z(1.03, 1.06), pct: '103–106%' },
      { id: 'Z5c', name: 'Anaerobic', range: [Math.round(lthr * 1.06) + 1, null], pct: '>106%' },
    ];
  }

  /* ------------------------------------------------------------------ */
  /* Profile -> fitness                                                  */
  /* ------------------------------------------------------------------ */
  function raceVdot(race) {
    const d = raceMeters(race), t = race.timeSec;
    if (!(d > 0) || !(t > 0)) return NaN;
    return vdotFromRace(d, t);
  }
  // choose which race drives the paces
  function pickPrimaryRace(profile) {
    const races = (profile.races || []).filter((r) => isFinite(raceVdot(r)));
    if (!races.length) return null;
    if (profile.primaryRaceId) { const r = races.find((x) => x.uid === profile.primaryRaceId); if (r) return r; }
    // default: best VDOT among races from the last 12 weeks; otherwise the most recent
    const now = Date.now();
    const recent = races.filter((r) => r.date && (now - new Date(r.date).getTime()) < 84 * 864e5);
    const pool = recent.length ? recent : races;
    return pool.slice().sort((a, b) => raceVdot(b) - raceVdot(a))[0];
  }
  function buildModel(profile) {
    if (!profile || !(profile.lthr > 0)) return null;
    const hr = hrProfile(profile.lthr, profile.hrMax);
    const race = pickPrimaryRace(profile);
    let fit = null;
    if (race) fit = fitnessFromVdot(raceVdot(race), profile.paceModel || 'blend');
    return { profile, hr, race, fit };
  }

  /* Pre-built session templates for the Paces page */
  const SESSION_TEMPLATES = [
    { id: 's3', label: '10 × 3 min', reps: 10, durSec: 180, feel: 'Crisp but controlled — the “short” session' },
    { id: 's6', label: '5 × 6 min', reps: 5, durSec: 360, feel: 'Steady and rhythmic — the “medium” session' },
    { id: 's10', label: '3 × 10 min', reps: 3, durSec: 600, feel: 'Relaxed but purposeful — the “long” session' },
  ];

  function describeRep(model, durSec) {
    const fit = model.fit, hr = model.hr;
    const pace = fit ? repPace(fit, durSec) : NaN;
    const rest = restWindow(durSec);
    const lag = lagBpm(durSec);
    const first = endHrBand(hr.lthr, 0, 10), last = endHrBand(hr.lthr, 9, 10);
    return {
      durSec, pace, paceLo: pace * 0.985, paceHi: pace * 1.03, // acceptable band (fast edge / slow edge)
      guide: fit ? guidePace(fit, durSec) : NaN, cop: fit ? copelandPace(fit, durSec) : NaN,
      eqKm: eqDistanceKm(durSec),
      rest,
      endHr: { early: [Math.round(first.lo), Math.round(first.hi)], late: [Math.round(last.lo), Math.round(last.hi)] },
      avgHr: [Math.round(first.lo - lag), Math.round(last.hi - lag)],
      lag,
    };
  }

  Object.assign(NSA, {
    KM_PER_MI, RACES, raceMeters, fmtTime, fmtPace, paceUnitLabel, parseTime, parsePace,
    vdotFromRace, raceTimeForVdot, raceVdot, fitnessFromVdot, repPace, guidePace, copelandPace, copelandAnchors,
    eqDistanceKm, repForDistance, restWindow, estimateHrMax, hrProfile, endHrBand, avgHrBand, lagBpm, lthrZones,
    buildModel, pickPrimaryRace, describeRep, SESSION_TEMPLATES, interp,
  });
})(typeof window !== 'undefined' ? window : globalThis);

;
/* Workout file parsers: FIT, GPX, TCX (+ .gz). Output is a normalised "raw workout":
 * { format, name, sport, subSport, startMs, records:[{t,lat,lon,alt,hr,cad,dist,speed}], laps:[{startT,endT,dur,dist,avgHr,intensity,trigger,stepIdx}] }
 * `t` is seconds since startMs (float).
 */
(function (root) {
  const NSA = root.NSA = root.NSA || {};
  const FIT_EPOCH_MS = Date.UTC(1989, 11, 31, 0, 0, 0);

  /* ---------------------------- FIT ---------------------------------- */
  const SIZES = { 0: 1, 1: 1, 2: 1, 3: 2, 4: 2, 5: 4, 6: 4, 7: 1, 8: 4, 9: 8, 10: 1, 11: 2, 12: 4, 13: 1, 14: 8, 15: 8, 16: 8 };
  const FIT_INTENSITY = ['active', 'rest', 'warmup', 'cooldown', 'recovery', 'interval', 'other'];
  const FIT_SPORT = { 1: 'running', 2: 'cycling', 5: 'swimming', 11: 'walking', 17: 'hiking', 10: 'training' };

  function readBase(dv, pos, bt, little) {
    switch (bt) {
      case 0: case 2: case 13: { const v = dv.getUint8(pos); return v === 0xFF ? null : v; }
      case 1: { const v = dv.getInt8(pos); return v === 0x7F ? null : v; }
      case 3: { const v = dv.getInt16(pos, little); return v === 0x7FFF ? null : v; }
      case 4: { const v = dv.getUint16(pos, little); return v === 0xFFFF ? null : v; }
      case 5: { const v = dv.getInt32(pos, little); return v === 0x7FFFFFFF ? null : v; }
      case 6: { const v = dv.getUint32(pos, little); return v === 0xFFFFFFFF ? null : v; }
      case 8: { const v = dv.getFloat32(pos, little); return isFinite(v) ? v : null; }
      case 9: { const v = dv.getFloat64(pos, little); return isFinite(v) ? v : null; }
      case 10: { const v = dv.getUint8(pos); return v === 0 ? null : v; }
      case 11: { const v = dv.getUint16(pos, little); return v === 0 ? null : v; }
      case 12: { const v = dv.getUint32(pos, little); return v === 0 ? null : v; }
      default: return null;
    }
  }

  function parseFit(arrayBuffer) {
    const dv = new DataView(arrayBuffer);
    const len = dv.byteLength;
    if (len < 14) throw new Error('File too small to be a FIT file');
    const hdrSize = dv.getUint8(0);
    const sig = String.fromCharCode(dv.getUint8(8), dv.getUint8(9), dv.getUint8(10), dv.getUint8(11));
    if (sig !== '.FIT') throw new Error('Not a FIT file (missing .FIT signature)');
    const dataSize = dv.getUint32(4, true);
    const end = Math.min(len - 2, hdrSize + dataSize);
    const defs = {};
    let pos = hdrSize, lastTs = 0;
    const records = [], lapsRaw = [], sessions = [];
    let guard = 0;

    while (pos < end && guard++ < 5e7) {
      const hdr = dv.getUint8(pos++);
      let def, compressedTs = null;
      if (hdr & 0x80) { // compressed timestamp header
        const local = (hdr >> 5) & 0x3;
        def = defs[local];
        const off = hdr & 0x1f;
        let ts = (lastTs & ~0x1f) + off;
        if (off < (lastTs & 0x1f)) ts += 32;
        compressedTs = ts; lastTs = ts;
      } else if (hdr & 0x40) { // definition
        const hasDev = !!(hdr & 0x20), local = hdr & 0x0f;
        pos++; // reserved
        const little = dv.getUint8(pos++) === 0;
        const globalNum = dv.getUint16(pos, little); pos += 2;
        const nf = dv.getUint8(pos++);
        const fields = [];
        let size = 0;
        for (let i = 0; i < nf; i++) {
          const num = dv.getUint8(pos), sz = dv.getUint8(pos + 1), bt = dv.getUint8(pos + 2) & 0x1f; pos += 3;
          fields.push({ num, sz, bt }); size += sz;
        }
        if (hasDev) {
          const nd = dv.getUint8(pos++);
          for (let i = 0; i < nd; i++) { size += dv.getUint8(pos + 1); pos += 3; }
        }
        defs[local] = { little, globalNum, fields, size };
        continue;
      } else def = defs[hdr & 0x0f];

      if (!def) throw new Error('Corrupt FIT file (data before definition)');
      const wanted = def.globalNum === 20 || def.globalNum === 19 || def.globalNum === 18;
      if (!wanted) { pos += def.size; if (def.globalNum === 21) { /* event ignored */ } continue; }
      const msg = {};
      let p = pos;
      for (const f of def.fields) {
        const bsz = SIZES[f.bt] || 1;
        if (f.bt === 7 || f.bt === 13 && f.sz > 1) { p += f.sz; continue; } // strings / byte arrays
        if (f.sz >= bsz && f.sz % bsz === 0) {
          const v = readBase(dv, p, f.bt, def.little);
          if (v != null) msg[f.num] = v;
        }
        p += f.sz;
      }
      pos += def.size;
      if (compressedTs != null) msg[253] = compressedTs;
      if (msg[253] != null) lastTs = msg[253];

      if (def.globalNum === 20) {
        if (msg[253] == null) continue;
        const r = { ts: msg[253] };
        if (msg[0] != null && msg[1] != null) { r.lat = msg[0] * 180 / 2147483648; r.lon = msg[1] * 180 / 2147483648; }
        const alt = msg[78] != null ? msg[78] : msg[2];
        if (alt != null) r.alt = alt / 5 - 500;
        if (msg[3] != null && msg[3] > 0) r.hr = msg[3];
        if (msg[4] != null) r.cad = msg[4] + (msg[53] ? msg[53] / 128 : 0);
        if (msg[5] != null) r.dist = msg[5] / 100;
        const spd = msg[73] != null ? msg[73] : msg[6];
        if (spd != null) r.speed = spd / 1000;
        if (msg[7] != null) r.power = msg[7];
        records.push(r);
      } else if (def.globalNum === 19) {
        lapsRaw.push(msg);
      } else if (def.globalNum === 18) {
        sessions.push(msg);
      }
    }
    if (!records.length) throw new Error('No record (time-series) data found in this FIT file');
    const t0 = records[0].ts;
    const startMs = FIT_EPOCH_MS + t0 * 1000;
    const outRecords = records.map((r) => { const o = Object.assign({}, r); o.t = r.ts - t0; delete o.ts; return o; });
    const laps = lapsRaw.map((l) => {
      const startTs = l[2] != null ? l[2] : (l[253] != null && l[7] != null ? l[253] - l[7] / 1000 : null);
      const dur = l[7] != null ? l[7] / 1000 : (l[8] != null ? l[8] / 1000 : null);
      if (startTs == null || dur == null) return null;
      return {
        startT: startTs - t0, endT: startTs - t0 + dur, dur,
        dist: l[9] != null ? l[9] / 100 : null,
        avgHr: l[15] != null ? l[15] : null,
        intensity: l[23] != null ? (FIT_INTENSITY[l[23]] || 'other') : null,
        trigger: l[24], stepIdx: l[71] != null ? l[71] : null,
      };
    }).filter(Boolean);
    const s = sessions[0] || {};
    return { format: 'FIT', name: '', sport: FIT_SPORT[s[5]] || (s[5] != null ? 'sport ' + s[5] : ''), subSport: s[6], startMs, records: outRecords, laps };
  }

  /* ---------------------------- XML helpers --------------------------- */
  function xmlDoc(text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('Could not read the XML in this file');
    return doc;
  }
  function kids(el, name) { const out = []; for (const c of el.children) if (c.localName === name) out.push(c); return out; }
  function kid(el, name) { for (const c of el.children) if (c.localName === name) return c; return null; }
  function firstDeep(el, name) { const l = el.getElementsByTagNameNS('*', name); return l.length ? l[0] : null; }
  function numText(el) { if (!el) return null; const v = parseFloat(el.textContent); return isFinite(v) ? v : null; }
  function haversine(la1, lo1, la2, lo2) {
    const R = 6371000, r = Math.PI / 180;
    const dLa = (la2 - la1) * r, dLo = (lo2 - lo1) * r;
    const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(dLo / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  /* ---------------------------- GPX ---------------------------------- */
  function parseGpx(text) {
    const doc = xmlDoc(text);
    const pts = doc.getElementsByTagNameNS('*', 'trkpt');
    if (!pts.length) throw new Error('No track points found in this GPX file');
    const recs = [];
    let name = '';
    const nm = firstDeep(doc.documentElement, 'name'); if (nm) name = nm.textContent.trim();
    let cum = 0, prev = null;
    for (const p of pts) {
      const tEl = kid(p, 'time'); if (!tEl) continue;
      const ms = Date.parse(tEl.textContent.trim()); if (!isFinite(ms)) continue;
      const lat = parseFloat(p.getAttribute('lat')), lon = parseFloat(p.getAttribute('lon'));
      const r = { ms, lat, lon };
      const ele = numText(kid(p, 'ele')); if (ele != null) r.alt = ele;
      const hr = numText(firstDeep(p, 'hr')); if (hr != null && hr > 0) r.hr = hr;
      const cad = numText(firstDeep(p, 'cad')); if (cad != null) r.cad = cad;
      const spd = numText(firstDeep(p, 'speed')); if (spd != null) r.speed = spd;
      if (prev && isFinite(lat) && isFinite(lon)) cum += haversine(prev.lat, prev.lon, lat, lon);
      r.dist = cum; prev = r;
      recs.push(r);
    }
    if (!recs.length) throw new Error('GPX has no timestamped points');
    const t0 = recs[0].ms;
    recs.forEach((r) => { r.t = (r.ms - t0) / 1000; delete r.ms; });
    const typeEl = firstDeep(doc.documentElement, 'type');
    return { format: 'GPX', name, sport: typeEl ? typeEl.textContent.trim() : '', startMs: t0, records: recs, laps: [] };
  }

  /* ---------------------------- TCX ---------------------------------- */
  function parseTcx(text) {
    const doc = xmlDoc(text);
    const laps = [], recs = [];
    const act = doc.getElementsByTagNameNS('*', 'Activity')[0];
    const sport = act ? (act.getAttribute('Sport') || '') : '';
    const lapEls = doc.getElementsByTagNameNS('*', 'Lap');
    let t0 = null, distOffset = 0, lastDist = 0, cumGps = 0, prev = null, anyDist = false;
    for (const lap of lapEls) {
      const lapStartMs = Date.parse(lap.getAttribute('StartTime') || '');
      const dur = numText(kid(lap, 'TotalTimeSeconds'));
      const dist = numText(kid(lap, 'DistanceMeters'));
      const ahr = kid(lap, 'AverageHeartRateBpm');
      const intensity = kid(lap, 'Intensity');
      const trig = kid(lap, 'TriggerMethod');
      laps.push({
        startMs: lapStartMs, dur, dist, avgHr: ahr ? numText(kid(ahr, 'Value')) : null,
        intensity: intensity ? (/rest/i.test(intensity.textContent) ? 'rest' : 'active') : null,
        trigger: trig ? trig.textContent.trim() : null,
      });
      for (const trk of kids(lap, 'Track')) {
        for (const tp of kids(trk, 'Trackpoint')) {
          const tEl = kid(tp, 'Time'); if (!tEl) continue;
          const ms = Date.parse(tEl.textContent.trim()); if (!isFinite(ms)) continue;
          if (t0 == null) t0 = ms;
          const r = { t: (ms - t0) / 1000 };
          const pos = kid(tp, 'Position');
          if (pos) { r.lat = numText(kid(pos, 'LatitudeDegrees')); r.lon = numText(kid(pos, 'LongitudeDegrees')); }
          const alt = numText(kid(tp, 'AltitudeMeters')); if (alt != null) r.alt = alt;
          const d = numText(kid(tp, 'DistanceMeters'));
          if (d != null) { r.dist = d; anyDist = true; }
          const hrEl = kid(tp, 'HeartRateBpm'); if (hrEl) { const h = numText(kid(hrEl, 'Value')); if (h) r.hr = h; }
          const cad = numText(kid(tp, 'Cadence')); if (cad != null) r.cad = cad;
          const spd = firstDeep(tp, 'Speed'); if (spd) r.speed = numText(spd);
          recs.push(r);
        }
      }
    }
    if (!recs.length) throw new Error('No trackpoints found in this TCX file');
    // fill distance if missing: haversine
    if (!anyDist) {
      for (const r of recs) {
        if (prev && r.lat != null && prev.lat != null) cumGps += haversine(prev.lat, prev.lon, r.lat, r.lon);
        r.dist = cumGps; prev = r;
      }
    }
    const outLaps = laps.filter((l) => isFinite(l.startMs) && l.dur != null).map((l) => ({
      startT: (l.startMs - t0) / 1000, endT: (l.startMs - t0) / 1000 + l.dur, dur: l.dur, dist: l.dist, avgHr: l.avgHr,
      intensity: l.intensity, trigger: l.trigger,
    }));
    return { format: 'TCX', name: '', sport, startMs: t0, records: recs, laps: outLaps };
  }

  /* ---------------------------- entry --------------------------------- */
  async function gunzip(buf) {
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot open .gz files — please unzip the file first');
    const ds = new DecompressionStream('gzip');
    const stream = new Blob([buf]).stream().pipeThrough(ds);
    return await new Response(stream).arrayBuffer();
  }
  async function parseBuffer(buf, fileName) {
    let u8 = new Uint8Array(buf);
    if (u8.length > 2 && u8[0] === 0x1f && u8[1] === 0x8b) { buf = await gunzip(buf); u8 = new Uint8Array(buf); }
    const isFit = u8.length > 12 && String.fromCharCode(u8[8], u8[9], u8[10], u8[11]) === '.FIT';
    let w;
    if (isFit) w = parseFit(buf);
    else {
      const text = new TextDecoder('utf-8').decode(buf);
      if (/<gpx[\s>]/i.test(text)) w = parseGpx(text);
      else if (/<TrainingCenterDatabase/i.test(text)) w = parseTcx(text);
      else throw new Error('Unsupported file. Please upload a .fit, .gpx or .tcx file (.gz is fine too).');
    }
    w.fileName = fileName || '';
    return w;
  }
  async function parseFile(file) { return parseBuffer(await file.arrayBuffer(), file.name); }

  Object.assign(NSA, { parseFit, parseGpx, parseTcx, parseBuffer, parseFile });
})(typeof window !== 'undefined' ? window : globalThis);

;
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

;
/* Generative-AI coach: builds a compact structured prompt from the analysis and calls the provider the user chose.
 * API keys never leave the device except in the request to the chosen provider. Only numbers (no GPS) are sent. */
(function (root) {
  const NSA = root.NSA = root.NSA || {};

  const PROVIDERS = {
    anthropic: { label: 'Anthropic (Claude)', model: 'claude-sonnet-5-5', keyHint: 'sk-ant-…', url: 'https://api.anthropic.com/v1/messages' },
    openai: { label: 'OpenAI (ChatGPT)', model: 'gpt-5', keyHint: 'sk-…', url: 'https://api.openai.com/v1/chat/completions' },
    gemini: { label: 'Google (Gemini)', model: 'gemini-2.5-flash', keyHint: 'AIza…', url: 'https://generativelanguage.googleapis.com/v1beta/models/' },
    compat: { label: 'OpenAI-compatible (OpenRouter, Ollama, …)', model: '', keyHint: 'key (optional for local)', url: '' },
  };

  const SYSTEM = `You are an experienced running coach specialising in the Norwegian Singles Approach (NSA / Norwegian Singles Method): single daily sessions at sub-threshold intensity (lactate roughly 2.5–3.5 mmol/L, below LT2), with short recoveries.
Method facts you must respect:
- Rep guide: ~3 min reps ≈ 12–15K race pace with ~60 s recovery; ~6 min ≈ 20K/half-marathon pace with 60–90 s; ~10 min ≈ 25–30K pace with 90–120 s. Any other rep length (distance- or time-based, custom ladders) is interpolated on the same curve.
- Early reps should finish ~10–15 bpm below LTHR, later reps approach LTHR from below; repeatedly exceeding LTHR means the pace is too hard.
- Sessions include a warm-up (~10 min easy) and cool-down (7–10 min easy). Sub-threshold work should be about 20–25% of weekly running time; everything else is genuinely easy (average HR ≲ 70% of max HR).
- Shortening recovery or running the jog faster is NOT a progression. Progress by adding one rep (or ~1 min total work) every 1–2 weeks once sessions feel easy; re-test with a race/time trial every 4–8 weeks.
The athlete's numbers are computed by an app from their latest race result (Daniels VDOT) and LTHR; treat them as the reference. Heart rate lags in short reps, and heat, hills, fatigue and GPS noise all matter — acknowledge uncertainty rather than over-claiming. Do not give medical advice. Be specific, concise and encouraging but honest. Use the athlete's units. Use Markdown with short sections and bullets.`;

  function r1(x) { return isFinite(x) ? Math.round(x * 10) / 10 : null; }

  function summarise(A, model, unit) {
    const P = (s) => NSA.fmtPace(s, unit) + NSA.paceUnitLabel(unit);
    const hr = model.hr, fit = model.fit;
    const lines = [];
    lines.push(`## Athlete`);
    lines.push(`- LTHR ${hr.lthr} bpm; HRmax ${hr.hrMax}${hr.hrMaxEstimated ? ' (estimated)' : ''}; easy-run HR cap ${hr.easyCap} bpm (≈70% HRmax); 85% LTHR = ${hr.easyStretch} bpm`);
    if (model.race) lines.push(`- Fitness reference: VDOT ${fit.vdot.toFixed(1)} (5K-equivalent ${NSA.fmtTime(fit.t5k)}; threshold pace ≈ ${P(fit.thresholdPace)}), pace model "${fit.method}"`);
    lines.push(`- Easy pace range ${P(fit.easy.fast)}–${P(fit.easy.slow)}`);
    lines.push(`## Workout`);
    const t = A.totals;
    lines.push(`- ${t.name}; ${t.format}; ${(t.distM / 1000).toFixed(2)} km in ${NSA.fmtTime(t.durSec)} (moving ${NSA.fmtTime(t.movingSec)}); avg HR ${isFinite(t.avgHr) ? Math.round(t.avgHr) : 'n/a'}, max HR ${isFinite(t.maxHr) ? Math.round(t.maxHr) : 'n/a'}`);
    lines.push(`- App score: ${A.scores.total}/100 (${A.verdict.label}); components: ` + A.scores.parts.map((p) => `${p.label} ${p.score} [${p.note}]`).join('; '));
    if (A.mode === 'intervals') {
      lines.push(`- Detected set: ${A.set.label}; ${A.set.n} reps, ${A.set.restCount} rest intervals; total work ${Math.round(A.set.workSec / 60)} min; avg rep pace ${P(A.set.avgPace)}; detection via ${A.method}`);
      lines.push(`- Warm-up ${Math.round(A.warmup.dur / 60)} min (avg HR ${isFinite(A.warmup.hr) ? Math.round(A.warmup.hr) : 'n/a'}); cool-down ${Math.round(A.cooldown.dur / 60)} min (avg HR ${isFinite(A.cooldown.hr) ? Math.round(A.cooldown.hr) : 'n/a'})`);
      lines.push(`### Reps (target is the app's pace for that rep duration)`);
      lines.push('| # | dur | pace | target | dev | avgHR | endHR | target endHR |');
      lines.push('|---|-----|------|--------|-----|-------|-------|--------------|');
      A.reps.forEach((r) => lines.push(`| ${r.idx} | ${NSA.fmtTime(r.dur)} | ${P(r.adjPace)} | ${P(r.target)} | ${(r.dev * 100).toFixed(1)}% | ${isFinite(r.hrAvg) ? Math.round(r.hrAvg) : '–'} | ${isFinite(r.endHr) ? Math.round(r.endHr) : '–'} | ${Math.round(r.endBand.lo)}–${Math.round(r.endBand.hi)} |`));
      if (A.rests.length) lines.push(`### Rests (s): ` + A.rests.map((r) => `${Math.round(r.dur)}${isFinite(r.hrDrop) ? ` (HR −${Math.round(r.hrDrop)})` : ''}`).join(', ') + `; recommended ${A.rests[0].win.lo}–${A.rests[0].win.hi} s for the first rep length`);
    } else {
      const e = A.easy;
      lines.push(`- Scored as an easy/steady run: ${(e.dist / 1000).toFixed(2)} km, avg pace ${P(e.movePace)}, avg HR ${isFinite(e.hrAvg) ? Math.round(e.hrAvg) : 'n/a'}, ${isFinite(e.fracAbove) ? Math.round(e.fracAbove * 100) : '?'}% of time above the easy cap, decoupling ${isFinite(e.drift) ? e.drift.toFixed(1) + '%' : 'n/a'}`);
    }
    lines.push(`### Rule-based findings`);
    A.findings.forEach((f) => lines.push(`- (${f.type}) ${f.text}`));
    return lines.join('\n');
  }

  function buildPrompt(A, model, unit, notes) {
    const body = summarise(A, model, unit);
    const ask = `Please coach me on this workout. Structure your answer as:
1. **Verdict** – one or two sentences on how well it matched Norwegian Singles intent (sub-threshold, repeatable).
2. **What went well**
3. **What to fix** – the most important 2–4 issues with specific numbers (paces/HR).
4. **Next session** – a concrete prescription (reps, pace range, end-of-rep HR progression, recovery, warm-up/cool-down) and when to progress or re-test.
5. **Context to consider** – heat, hills, HR lag in short reps, stale race result, fatigue – only what the data hints at.
Keep it under ~350 words.` + (notes ? `\n\nMy own notes about the session: ${notes}` : '');
    return { system: SYSTEM, user: body + '\n\n' + ask, plain: SYSTEM + '\n\n' + body + '\n\n' + ask };
  }

  async function post(url, headers, body) {
    let res;
    try { res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) }); }
    catch (e) { throw new Error('Network/CORS error calling the AI provider (' + e.message + '). Check your internet connection and key, or use “Copy prompt” instead.'); }
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch (e) { json = null; }
    if (!res.ok) {
      const msg = json && (json.error && (json.error.message || json.error) || json.message) || text.slice(0, 300);
      throw new Error('AI provider error ' + res.status + ': ' + (typeof msg === 'string' ? msg : JSON.stringify(msg)));
    }
    return json;
  }

  // messages: [{role:'user'|'assistant', content}]
  async function chat(cfg, system, messages) {
    const key = (cfg.key || '').trim();
    const prov = cfg.provider || 'anthropic';
    const model = (cfg.model || PROVIDERS[prov].model || '').trim();
    if (!key && prov !== 'compat') throw new Error('Add your API key in Settings → AI coach first.');
    if (!model) throw new Error('Enter a model name in Settings → AI coach.');
    if (prov === 'anthropic') {
      const j = await post(PROVIDERS.anthropic.url, {
        'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      }, { model, max_tokens: 1800, system, messages });
      return (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
    }
    if (prov === 'openai' || prov === 'compat') {
      const url = prov === 'openai' ? PROVIDERS.openai.url : (cfg.baseUrl || '').replace(/\/+$/, '') + '/chat/completions';
      if (prov === 'compat' && !cfg.baseUrl) throw new Error('Enter the base URL of your OpenAI-compatible endpoint.');
      const headers = { 'content-type': 'application/json' }; if (key) headers.authorization = 'Bearer ' + key;
      const j = await post(url, headers, { model, messages: [{ role: 'system', content: system }].concat(messages) });
      return ((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '').trim();
    }
    if (prov === 'gemini') {
      const url = PROVIDERS.gemini.url + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(key);
      const j = await post(url, { 'content-type': 'application/json' }, {
        systemInstruction: { parts: [{ text: system }] },
        contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      });
      const parts = j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts || [];
      return parts.map((p) => p.text || '').join('\n').trim();
    }
    throw new Error('Unknown AI provider');
  }

  /* Tiny, safe Markdown -> HTML (headings, bold, italics, lists, tables-as-text, paragraphs). */
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function inline(s) { return esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, '$1<em>$2</em>').replace(/`([^`]+)`/g, '<code>$1</code>'); }
  function mdToHtml(md) {
    const out = []; let list = null;
    const close = () => { if (list) { out.push('</' + list + '>'); list = null; } };
    for (const raw of String(md).split(/\r?\n/)) {
      const line = raw.trimEnd();
      let m;
      if (!line.trim()) { close(); continue; }
      if ((m = line.match(/^#{1,4}\s+(.*)$/))) { close(); out.push('<h4>' + inline(m[1]) + '</h4>'); continue; }
      if ((m = line.match(/^\s*(?:[-*•])\s+(.*)$/))) { if (list !== 'ul') { close(); out.push('<ul>'); list = 'ul'; } out.push('<li>' + inline(m[1]) + '</li>'); continue; }
      if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) { if (list !== 'ol') { close(); out.push('<ol>'); list = 'ol'; } out.push('<li>' + inline(m[1]) + '</li>'); continue; }
      if (/^\s*\|?[-: |]+\|?\s*$/.test(line) && line.includes('-')) continue;
      close(); out.push('<p>' + inline(line) + '</p>');
    }
    close(); return out.join('');
  }

  NSA.AI = { PROVIDERS, SYSTEM, summarise, buildPrompt, chat, mdToHtml, esc };
})(typeof window !== 'undefined' ? window : globalThis);

;
/* NSA Pacer — UI (shared by the mobile PWA and the desktop standalone build) */
(function () {
  const NSA = window.NSA;
  const APP_VERSION = '1.0.0';
  const LS_KEY = 'nsa-pacer.v1';
  const LAYOUT = document.body.getAttribute('data-layout') || 'mobile';

  /* ----------------------------- state ------------------------------ */
  const DEFAULTS = () => ({
    profile: { lthr: 178, hrMax: null, unit: 'km', paceModel: 'blend', races: [], primaryRaceId: null },
    ai: { provider: 'anthropic', key: '', model: '', baseUrl: '', remember: true },
    history: [],
    prefs: { gradeAdjust: true, tab: null },
    calc: { mode: 'time', value: '4:00', reps: 6 },
  });
  let storageOk = true;
  function load() {
    const d = DEFAULTS();
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const j = JSON.parse(raw);
        for (const k of Object.keys(d)) if (j[k] && typeof j[k] === 'object' && !Array.isArray(j[k])) Object.assign(d[k], j[k]);
        if (Array.isArray(j.history)) d.history = j.history;
        if (j.profile && Array.isArray(j.profile.races)) d.profile.races = j.profile.races;
      }
    } catch (e) { storageOk = false; }
    return d;
  }
  const state = load();
  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        const copy = JSON.parse(JSON.stringify(state));
        if (!state.ai.remember) copy.ai.key = '';
        localStorage.setItem(LS_KEY, JSON.stringify(copy));
      } catch (e) { storageOk = false; }
    }, 150);
  }

  /* ----------------------------- helpers ---------------------------- */
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = (s) => NSA.AI.esc(s == null ? '' : s);
  const uid = () => Math.random().toString(36).slice(2, 10);
  const unit = () => state.profile.unit;
  const P = (s) => NSA.fmtPace(s, unit());
  const PU = () => NSA.paceUnitLabel(unit());
  const fmtT = NSA.fmtTime;
  const isNum = (x) => typeof x === 'number' && isFinite(x);
  const todayStr = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const dist = (m) => unit() === 'mi' ? (m / 1609.344).toFixed(2) + ' mi' : (m / 1000).toFixed(2) + ' km';
  const getModel = () => NSA.buildModel(state.profile);
  function toast(msg, kind) {
    const el = $('#toast'); el.textContent = msg; el.className = 'toast show ' + (kind || '');
    clearTimeout(toast.t); toast.t = setTimeout(() => { el.className = 'toast'; }, kind === 'err' ? 6000 : 2800);
  }
  const ICON = {
    inputs: '<path d="M4 6h16M4 12h16M4 18h10"/><circle cx="18" cy="18" r="2"/>',
    paces: '<path d="M12 3v9l5 3"/><circle cx="12" cy="12" r="9"/>',
    analyze: '<path d="M3 17l5-6 4 3 5-8 4 5"/><path d="M3 21h18"/>',
    history: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
  };
  const TABS = [['inputs', 'Inputs'], ['paces', 'Paces'], ['analyze', 'Analyze'], ['history', 'History'], ['settings', 'Settings']];

  /* ----------------------------- shell ------------------------------ */
  let tab = 'paces';
  function renderNav() {
    const html = TABS.map(([id, label]) => `<button class="nav-btn${tab === id ? ' on' : ''}" data-act="tab" data-tab="${id}" aria-label="${label}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[id]}</svg><span>${label}</span></button>`).join('');
    $('#nav').innerHTML = html;
    $('#unit-toggle').textContent = unit() === 'km' ? 'min/km' : 'min/mi';
  }
  function go(t) {
    tab = t; state.prefs.tab = t; save();
    renderNav(); renderView();
    window.scrollTo(0, 0);
  }
  function renderView() {
    const el = $('#view');
    el.setAttribute('data-view', tab);
    switch (tab) {
      case 'inputs': el.innerHTML = viewInputs(); bindInputs(); break;
      case 'paces': el.innerHTML = viewPaces(); bindPaces(); break;
      case 'analyze': el.innerHTML = viewAnalyze(); bindAnalyze(); break;
      case 'history': el.innerHTML = viewHistory(); break;
      case 'settings': el.innerHTML = viewSettings(); bindSettings(); break;
    }
  }

  /* ----------------------------- INPUTS ----------------------------- */
  function raceSummary(r) {
    const v = NSA.raceVdot(r);
    if (!isFinite(v)) return null;
    const label = r.id === 'custom' ? (r.customKm || 0) + ' km' : NSA.RACES.find((x) => x.id === r.id).label;
    return { v, label, t5k: NSA.raceTimeForVdot(v, 5000) };
  }
  function viewInputs() {
    const p = state.profile;
    const m = getModel();
    const races = p.races.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const primary = m && m.race;
    const raceRows = races.map((r) => {
      const s = raceSummary(r); if (!s) return '';
      const isPrimary = primary && primary.uid === r.uid;
      return `<li class="race-row${isPrimary ? ' primary' : ''}">
        <label class="radio"><input type="radio" name="primary" value="${r.uid}" ${isPrimary ? 'checked' : ''}><span></span></label>
        <div class="race-main"><b>${esc(s.label)}</b> <span class="mono">${fmtT(r.timeSec)}</span>
          <div class="sub">${r.date ? esc(r.date) + ' · ' : ''}VDOT ${s.v.toFixed(1)} · 5K-equiv ${fmtT(s.t5k)}${r.name ? ' · ' + esc(r.name) : ''}${isPrimary ? ' · <span class="tag">drives paces</span>' : ''}</div></div>
        <button class="icon-btn" data-act="del-race" data-id="${r.uid}" aria-label="Delete race">×</button></li>`;
    }).join('');
    const raceOpts = NSA.RACES.map((r) => `<option value="${r.id}"${r.id === '5k' ? ' selected' : ''}>${r.label}</option>`).join('');
    return `
    <div class="page-head"><h1>Your inputs</h1><p class="lead">Saved on this device. Paces and heart-rate targets update instantly.</p></div>
    <div class="grid two">
      <section class="card">
        <h2>Heart rate</h2>
        <div class="field"><label for="in-lthr">Lactate-threshold HR (LTHR)</label>
          <div class="inline"><input id="in-lthr" type="number" inputmode="numeric" min="100" max="230" value="${p.lthr || ''}"><span class="unit">bpm</span></div>
          <p class="hint">Field test: warm up, then run a solo, well-paced 30-minute max effort. LTHR = average HR over the <b>last 20 minutes</b>. Chest strap is best.</p></div>
        <div class="field"><label for="in-hrmax">Max HR <span class="opt">(optional)</span></label>
          <div class="inline"><input id="in-hrmax" type="number" inputmode="numeric" min="120" max="230" placeholder="${p.lthr ? NSA.estimateHrMax(p.lthr) + ' (estimated)' : ''}" value="${p.hrMax || ''}"><span class="unit">bpm</span></div>
          <p class="hint">Used for the easy-run cap (≈70% of max HR). Leave blank to estimate from LTHR.</p></div>
        <div class="field row2">
          <div><label for="in-unit">Pace units</label><select id="in-unit"><option value="km"${p.unit === 'km' ? ' selected' : ''}>min/km</option><option value="mi"${p.unit === 'mi' ? ' selected' : ''}>min/mile</option></select></div>
          <div><label for="in-model">Pace model</label><select id="in-model">
            <option value="blend"${p.paceModel === 'blend' ? ' selected' : ''}>Blend (default)</option>
            <option value="guide"${p.paceModel === 'guide' ? ' selected' : ''}>Singles guide</option>
            <option value="copeland"${p.paceModel === 'copeland' ? ' selected' : ''}>Copeland table</option></select></div>
        </div>
      </section>
      <section class="card">
        <h2>Recent race results</h2>
        <p class="hint" style="margin-top:0">Add one or more recent, all-out efforts (race, parkrun, time trial). Paces use the race you tick — by default the best from the last 12 weeks.</p>
        <div class="race-form">
          <div class="field"><label for="rf-dist">Distance</label><select id="rf-dist">${raceOpts}</select></div>
          <div class="field" id="rf-custom-wrap" hidden><label for="rf-custom">Custom km</label><input id="rf-custom" type="number" step="0.01" inputmode="decimal" placeholder="e.g. 12"></div>
          <div class="field"><label for="rf-time">Time</label><input id="rf-time" type="text" inputmode="numeric" placeholder="20:00 or 1:35:30" autocomplete="off"></div>
          <div class="field"><label for="rf-date">Date</label><input id="rf-date" type="date" value="${todayStr()}"></div>
          <div class="field"><label for="rf-name">Note <span class="opt">(optional)</span></label><input id="rf-name" type="text" placeholder="e.g. parkrun, flat course"></div>
          <button class="btn primary" data-act="add-race">Add result</button>
        </div>
        <ul class="race-list">${raceRows || '<li class="empty">No results yet — add one to calculate your paces.</li>'}</ul>
      </section>
    </div>
    <section class="card" id="in-preview">${previewHtml(m)}</section>`;
  }
  function previewHtml(m) {
    if (!m) return '<h2>Preview</h2><p class="hint">Enter your LTHR to see heart-rate targets.</p>';
    if (!m.fit) return `<h2>Preview</h2><p class="hint">LTHR set. Add a race result to unlock paces. Heart-rate targets are available now (see Paces).</p>`;
    const f = m.fit, d3 = NSA.describeRep(m, 180), d6 = NSA.describeRep(m, 360), d10 = NSA.describeRep(m, 600);
    return `<h2>Preview</h2>
      <div class="stat-row">
        <div class="stat"><div class="k">VDOT</div><div class="v">${f.vdot.toFixed(1)}</div></div>
        <div class="stat"><div class="k">5K-equivalent</div><div class="v">${fmtT(f.t5k)}</div></div>
        <div class="stat"><div class="k">3 min reps</div><div class="v">${P(d3.pace)}<small>${PU()}</small></div></div>
        <div class="stat"><div class="k">6 min reps</div><div class="v">${P(d6.pace)}<small>${PU()}</small></div></div>
        <div class="stat"><div class="k">10 min reps</div><div class="v">${P(d10.pace)}<small>${PU()}</small></div></div>
      </div>
      <p><button class="btn" data-act="tab" data-tab="paces">See all paces →</button></p>`;
  }
  function bindInputs() {
    const num = (id, key, lo, hi) => $(id).addEventListener('input', (e) => {
      const v = parseFloat(e.target.value);
      state.profile[key] = isFinite(v) && v >= lo && v <= hi ? Math.round(v) : (e.target.value === '' ? null : state.profile[key]);
      save(); $('#in-preview').innerHTML = previewHtml(getModel());
    });
    num('#in-lthr', 'lthr', 100, 230); num('#in-hrmax', 'hrMax', 120, 230);
    $('#in-unit').addEventListener('change', (e) => { state.profile.unit = e.target.value; save(); renderNav(); $('#in-preview').innerHTML = previewHtml(getModel()); });
    $('#in-model').addEventListener('change', (e) => { state.profile.paceModel = e.target.value; save(); $('#in-preview').innerHTML = previewHtml(getModel()); });
    $('#rf-dist').addEventListener('change', (e) => { $('#rf-custom-wrap').hidden = e.target.value !== 'custom'; });
    $$('input[name=primary]').forEach((r) => r.addEventListener('change', (e) => { state.profile.primaryRaceId = e.target.value; save(); renderView(); }));
  }

  /* ----------------------------- PACES ------------------------------ */
  function sessionCard(m, tpl) {
    const d = NSA.describeRep(m, tpl.durSec);
    const restMid = (d.rest.lo + d.rest.hi) / 2;
    const total = 600 + tpl.reps * tpl.durSec + tpl.reps * restMid + 480;
    const hasPace = isNum(d.pace);
    return `<article class="card session">
      <header><h3>${tpl.label}</h3><span class="chip">≈ ${d.eqKm.toFixed(d.eqKm < 20 ? 1 : 0)}K race pace</span></header>
      <p class="feel">${tpl.feel}</p>
      ${hasPace ? `<div class="bigpace"><span class="n">${P(d.pace)}</span><span class="u">${PU()}</span><span class="range">${P(d.paceLo)}–${P(d.paceHi)}</span></div>` : '<p class="hint">Add a race result for pace targets.</p>'}
      <dl class="kv">
        <dt>End-of-rep HR</dt><dd>Rep 1: <b>${d.endHr.early[0]}–${d.endHr.early[1]}</b> → last: <b>${d.endHr.late[0]}–${d.endHr.late[1]}</b> bpm</dd>
        <dt>Avg HR in rep</dt><dd>~${d.avgHr[0]}–${d.avgHr[1]} bpm <span class="muted">(HR lags ~${Math.round(d.lag)} bpm)</span></dd>
        <dt>Recovery</dt><dd>${d.rest.lo}–${d.rest.hi} s easy jog/walk ${tpl.reps}×</dd>
        <dt>Session</dt><dd>10′ WU · ${tpl.label} · 8′ CD ≈ <b>${Math.round(total / 60)} min</b> (${Math.round(tpl.reps * tpl.durSec / 60)} min of work)</dd>
        <dt>Ceiling</dt><dd>Never finish a rep above <b>${m.hr.lthr}</b> bpm</dd>
      </dl></article>`;
  }
  function viewPaces() {
    const m = getModel();
    if (!m) return `<div class="page-head"><h1>Paces</h1></div><section class="card"><p>Enter your LTHR and a recent race result on the <button class="link" data-act="tab" data-tab="inputs">Inputs</button> page first.</p></section>`;
    const hr = m.hr, fit = m.fit;
    const hero = fit ? `
      <section class="card hero">
        <div class="hero-main">
          <div class="k">Fitness reference</div>
          <div class="v">VDOT ${fit.vdot.toFixed(1)}</div>
          <div class="sub">from ${esc(raceSummary(m.race).label)} in ${fmtT(m.race.timeSec)}${m.race.date ? ' · ' + esc(m.race.date) : ''} · 5K-equivalent <b>${fmtT(fit.t5k)}</b></div>
        </div>
        <div class="stat-row compact">
          <div class="stat"><div class="k">Threshold pace (≈60 min)</div><div class="v">${P(fit.thresholdPace)}<small>${PU()}</small></div></div>
          <div class="stat"><div class="k">LTHR</div><div class="v">${hr.lthr}<small> bpm</small></div></div>
          <div class="stat"><div class="k">Easy HR cap</div><div class="v">${hr.easyCap}<small> bpm</small></div></div>
        </div>
      </section>` : `<section class="card"><p>Heart-rate targets are shown below. <button class="link" data-act="tab" data-tab="inputs">Add a race result</button> to get pace targets.</p></section>`;
    const sessions = NSA.SESSION_TEMPLATES.map((t) => sessionCard(m, t)).join('');
    const easy = `<section class="card">
      <h2>Easy &amp; long runs</h2>
      <div class="grid two inner">
        <div><div class="k">Heart rate</div><div class="big">≤ ${hr.easyCap} <small>bpm</small></div>
          <p class="hint">Average HR ≲ 70% of max HR (${hr.hrMax}${hr.hrMaxEstimated ? ' est.' : ''}). Hard stop at 85% LTHR = ${hr.easyStretch} bpm in heat or at the end of a long run.</p></div>
        <div><div class="k">Pace</div><div class="big">${fit ? P(fit.easy.fast) + '–' + P(fit.easy.slow) : '–'} <small>${PU()}</small></div>
          <p class="hint">HR rules over pace on easy days. Walk hills if needed — the long run is easy too.</p></div>
      </div></section>`;

    // custom calculator
    const calc = `<section class="card" id="calc">
      <h2>Any rep length (custom calculator)</h2>
      <p class="hint" style="margin-top:0">The model isn’t limited to 3, 6 and 10 minutes — enter any rep by time or distance.</p>
      <div class="calc-form">
        <div class="field"><label for="c-mode">Rep defined by</label><select id="c-mode"><option value="time"${state.calc.mode === 'time' ? ' selected' : ''}>Time (m:ss)</option><option value="dist"${state.calc.mode === 'dist' ? ' selected' : ''}>Distance (m)</option></select></div>
        <div class="field"><label for="c-val">Value</label><input id="c-val" type="text" inputmode="numeric" value="${esc(state.calc.value)}"></div>
        <div class="field"><label for="c-reps">Reps</label><input id="c-reps" type="number" min="1" max="40" value="${state.calc.reps}"></div>
      </div>
      <div id="calc-out">${calcOut(m)}</div></section>`;

    // table by duration & distance
    const durRows = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20].map((min) => {
      const d = NSA.describeRep(m, min * 60);
      return `<tr><td>${min} min</td><td class="mono b">${fit ? P(d.pace) : '–'}</td><td class="mono muted">${fit ? P(d.paceLo) + '–' + P(d.paceHi) : ''}</td><td>≈ ${d.eqKm.toFixed(d.eqKm < 20 ? 1 : 0)}K</td><td class="mono">${d.rest.lo}–${d.rest.hi} s</td></tr>`;
    }).join('');
    const distRows = fit ? [400, 600, 800, 1000, 1200, 1600, 2000, 3000].map((dm) => {
      const r = NSA.repForDistance(fit, dm);
      return `<tr><td>${dm >= 1000 ? dm / 1000 + ' km' : dm + ' m'}</td><td class="mono b">${P(r.pace)}</td><td class="mono">${fmtT(r.durSec)}</td><td class="mono">${NSA.restWindow(r.durSec).lo}–${NSA.restWindow(r.durSec).hi} s</td></tr>`;
    }).join('') : '';
    const tables = `<div class="grid two"><section class="card"><h2>By duration</h2><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Rep</th><th>Target</th><th>Band</th><th>Feels like</th><th>Rest</th></tr></thead><tbody>${durRows}</tbody></table></div><p class="hint">Band = −1.5% / +3% around target. Shorter than 3 min is capped at 10K pace; longer than ~15 min tends toward marathon pace.</p></section>
      <section class="card"><h2>By distance</h2>${fit ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Rep</th><th>Target</th><th>Rep time</th><th>Rest</th></tr></thead><tbody>${distRows}</tbody></table></div>` : '<p class="hint">Needs a race result.</p>'}</section></div>`;

    // zones
    const zones = NSA.lthrZones(hr.lthr).map((z) => `<tr class="${z.id === 'Z4' ? 'hl' : ''}"><td><b>${z.id}</b></td><td>${z.name}</td><td class="mono">${z.range[0] == null ? '< ' + (z.range[1] + 1) : z.range[1] == null ? '> ' + (z.range[0] - 1) : z.range[0] + '–' + z.range[1]}</td><td class="muted">${z.pct}</td></tr>`).join('');
    const preds = fit ? [[5000, '5 km'], [10000, '10 km'], [21097.5, 'Half marathon'], [42195, 'Marathon']].map(([dm, l]) => {
      const t = NSA.raceTimeForVdot(fit.vdot, dm); return `<tr><td>${l}</td><td class="mono b">${fmtT(t)}</td><td class="mono muted">${P(t / (dm / 1000))}${PU()}</td></tr>`;
    }).join('') : '';
    const zonesCard = `<div class="grid two"><section class="card"><h2>LTHR zones</h2><div class="tbl-wrap"><table class="tbl"><thead><tr><th></th><th>Zone</th><th>bpm</th><th>% LTHR</th></tr></thead><tbody>${zones}</tbody></table></div>
      <p class="hint">Friel running zones. Sub-threshold reps live in Z4 – low Z5a: early reps finish 10–15 bpm below LTHR (${hr.lthr - 15}–${hr.lthr - 10}), later reps approach ${hr.lthr} from below.</p></section>
      <section class="card"><h2>Race equivalents</h2>${fit ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Distance</th><th>Time</th><th>Pace</th></tr></thead><tbody>${preds}</tbody></table></div><p class="hint">Daniels VDOT equivalence. Long-distance predictions assume matching endurance training.</p>` : '<p class="hint">Needs a race result.</p>'}
      <h3 style="margin-top:1.2em">Weekly shape</h3><p class="hint" style="margin-top:.2em">2–3 sub-threshold sessions + easy runs + a long easy run. Sub-threshold work ≈ <b>20–25%</b> of weekly running time (count only rep minutes). Example week: easy · 3×10′ · easy · 5×6′ · easy · 10×3′ · long easy. Re-test every 4–8 weeks.</p></section></div>`;
    return `<div class="page-head"><h1>Your NSA paces</h1><p class="lead">Sub-threshold targets from your latest race and LTHR.</p></div>
      ${hero}<div class="grid three sessions">${sessions}</div>${easy}${calc}${tables}${zonesCard}`;
  }
  function calcOut(m) {
    const fit = m.fit; if (!fit) return '<p class="hint">Add a race result first.</p>';
    const c = state.calc;
    let dur, pace;
    if (c.mode === 'time') { dur = NSA.parseTime(c.value); if (!(dur >= 20 && dur <= 3600)) return '<p class="hint">Enter a rep time between 0:20 and 60:00 (e.g. 4:30).</p>'; pace = NSA.repPace(fit, dur); }
    else { const dm = parseFloat(c.value); if (!(dm >= 100 && dm <= 15000)) return '<p class="hint">Enter a distance between 100 and 15000 m.</p>'; const r = NSA.repForDistance(fit, dm); dur = r.durSec; pace = r.pace; }
    const d = NSA.describeRep(m, dur), n = Math.max(1, Math.min(40, c.reps | 0 || 1));
    const restMid = (d.rest.lo + d.rest.hi) / 2, total = 600 + n * dur + n * restMid + 480;
    const dm = dur / pace * 1000;
    return `<div class="stat-row">
      <div class="stat"><div class="k">Target pace</div><div class="v">${P(pace)}<small>${PU()}</small></div></div>
      <div class="stat"><div class="k">Rep</div><div class="v">${fmtT(dur)}<small> · ${dm >= 1000 ? (dm / 1000).toFixed(2) + ' km' : Math.round(dm) + ' m'}</small></div></div>
      <div class="stat"><div class="k">Rest</div><div class="v">${d.rest.lo}–${d.rest.hi}<small> s</small></div></div>
      <div class="stat"><div class="k">${n} reps work</div><div class="v">${Math.round(n * dur / 60)}<small> min</small></div></div>
      <div class="stat"><div class="k">Session</div><div class="v">${Math.round(total / 60)}<small> min</small></div></div></div>
      <p class="hint">Acceptable band ${P(d.paceLo)}–${P(d.paceHi)}${PU()} · ≈ ${d.eqKm.toFixed(d.eqKm < 20 ? 1 : 0)}K race pace · end-of-rep HR ${d.endHr.early[0]}–${d.endHr.early[1]} (early) → ${d.endHr.late[0]}–${d.endHr.late[1]} bpm (late); never above ${m.hr.lthr}. Session = 10′ WU + work + ${n} rests + 8′ CD.</p>`;
  }
  function bindPaces() {
    const upd = () => { state.calc.mode = $('#c-mode').value; state.calc.value = $('#c-val').value; state.calc.reps = parseInt($('#c-reps').value, 10) || 1; save(); const m = getModel(); if (m) $('#calc-out').innerHTML = calcOut(m); };
    ['#c-mode', '#c-val', '#c-reps'].forEach((s) => { const el = $(s); if (el) el.addEventListener('input', upd); });
    const mode = $('#c-mode'); if (mode) mode.addEventListener('change', () => { $('#c-val').value = mode.value === 'time' ? '4:00' : '1000'; upd(); });
  }

  /* ----------------------------- ANALYZE ---------------------------- */
  let current = null; // {raw, A, opts, fileName, ai:{text, messages, busy, error}}
  const aOpts = { sensitivity: 0, force: 'auto', detect: 'auto', gradeAdjust: null };
  function viewAnalyze() {
    const m = getModel();
    const warn = !m ? '<p class="banner warn">Add your LTHR and a recent race on <button class="link" data-act="tab" data-tab="inputs">Inputs</button> so workouts can be scored against your targets.</p>' : !m.fit ? '<p class="banner warn">No race result yet — scoring needs it. <button class="link" data-act="tab" data-tab="inputs">Add one</button>.</p>' : '';
    return `<div class="page-head"><h1>Analyze a workout</h1><p class="lead">Upload .fit, .gpx or .tcx (or .gz). Files are processed in your browser; nothing is uploaded unless you request AI coaching, and then only numbers — no GPS.</p></div>
      ${warn}
      <label class="drop" id="drop" for="file"><input id="file" type="file" accept=".fit,.gpx,.tcx,.gz,application/gpx+xml,application/vnd.garmin.tcx+xml,application/octet-stream,text/xml" multiple hidden>
        <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M7 9l5-5 5 5M4 20h16"/></svg>
        <b>${LAYOUT === 'desktop' ? 'Drop a workout file here, or click to choose' : 'Tap to choose a workout file'}</b><span>FIT · GPX · TCX — select several to add them all to History</span></label>
      <div id="result">${current ? resultHtml() : ''}</div>`;
  }
  function bindAnalyze() {
    const drop = $('#drop'), file = $('#file');
    file.addEventListener('change', () => { handleFiles(Array.from(file.files)); file.value = ''; });
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', (e) => { const fs = Array.from(e.dataTransfer.files || []); if (fs.length) handleFiles(fs); });
    if (current) bindResult();
  }
  async function handleFiles(files) {
    const m = getModel();
    if (!m || !m.fit) { toast('Add LTHR and a race result first (Inputs).', 'err'); return; }
    const res = $('#result'); res.innerHTML = '<div class="card loading"><span class="spin"></span> Reading and analysing…</div>';
    let last = null, ok = 0;
    for (const f of files) {
      try {
        const raw = await NSA.parseFile(f);
        const entry = { raw, fileName: f.name, ai: null };
        entry.A = NSA.analyzeWorkout(raw, m, runOpts());
        pushHistory(entry);
        last = entry; ok++;
      } catch (e) { console.error(e); toast(f.name + ': ' + (e.message || e), 'err'); }
    }
    if (last) { current = last; if (files.length > 1) toast(ok + ' workouts analysed and saved to History.'); }
    res.innerHTML = current ? resultHtml() : '';
    if (current) bindResult();
  }
  function runOpts() { return { unit: unit(), sensitivity: aOpts.sensitivity, force: aOpts.force, detect: aOpts.detect, gradeAdjust: aOpts.gradeAdjust == null ? state.prefs.gradeAdjust : aOpts.gradeAdjust }; }
  function reanalyze() {
    const m = getModel(); if (!current || !m || !m.fit) return;
    try { current.A = NSA.analyzeWorkout(current.raw, m, runOpts()); pushHistory(current, true); } catch (e) { toast(e.message, 'err'); return; }
    const y = window.scrollY; $('#result').innerHTML = resultHtml(); bindResult(); window.scrollTo(0, y);
  }
  function pushHistory(entry, replace) {
    const A = entry.A, id = (entry.fileName || '') + '|' + (A.totals.startMs || '');
    const devs = A.reps ? A.reps.map((r) => r.dev) : [];
    const rec = {
      id, ts: A.totals.startMs || Date.now(), name: entry.fileName || A.totals.name, label: A.mode === 'intervals' ? A.set.label : 'Easy / steady run',
      mode: A.mode, score: A.scores.total, verdict: A.verdict.label, tone: A.verdict.tone, distM: A.totals.distM, durSec: A.totals.durSec, avgHr: A.totals.avgHr,
      dev: devs.length ? devs.reduce((a, b) => a + b, 0) / devs.length : null, lthr: state.profile.lthr, vdot: getModel().fit.vdot,
    };
    const i = state.history.findIndex((h) => h.id === id);
    if (i >= 0) state.history[i] = rec; else state.history.push(rec);
    state.history.sort((a, b) => a.ts - b.ts); save();
  }

  function ring(score, tone) {
    const r = 54, c = 2 * Math.PI * r, off = c * (1 - Math.max(0, Math.min(100, score)) / 100);
    return `<svg class="ring ${tone}" viewBox="0 0 130 130" role="img" aria-label="Score ${score} out of 100"><circle class="trk" cx="65" cy="65" r="${r}"/><circle class="val" cx="65" cy="65" r="${r}" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 65 65)"/><text x="65" y="64" class="n">${score}</text><text x="65" y="84" class="d">/ 100</text></svg>`;
  }
  function resultHtml() {
    const A = current.A, m = getModel();
    const t = A.totals;
    const date = t.startMs ? new Date(t.startMs).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '';
    const bars = A.scores.parts.map((p) => `<div class="bar-row"><div class="bar-label">${esc(p.label)} <span class="muted">· ${p.eff}%</span></div><div class="bar"><i style="width:${p.score}%" class="${p.score >= 85 ? 'g' : p.score >= 70 ? 'a' : 'r'}"></i></div><div class="bar-val">${p.score}</div><div class="bar-note">${esc(p.note)}</div></div>`).join('');
    const summ = [];
    summ.push(['Distance', dist(t.distM)], ['Time', fmtT(t.durSec)]);
    if (isNum(t.avgHr)) summ.push(['Avg / max HR', Math.round(t.avgHr) + ' / ' + Math.round(t.maxHr)]);
    if (A.mode === 'intervals') {
      summ.push(['Set', esc(A.set.label)], ['Work', Math.round(A.set.workSec / 60) + ' min @ ' + P(A.set.avgPace) + PU()], ['Rests', A.set.restCount + ' × ~' + (A.rests.length ? Math.round(A.rests.reduce((s, r) => s + r.dur, 0) / A.rests.length) : 0) + ' s'],
        ['Warm-up', Math.round(A.warmup.dur / 60) + ' min' + (isNum(A.warmup.hr) ? ' · ' + Math.round(A.warmup.hr) + ' bpm' : '')], ['Cool-down', Math.round(A.cooldown.dur / 60) + ' min' + (isNum(A.cooldown.hr) ? ' · ' + Math.round(A.cooldown.hr) + ' bpm' : '')]);
    } else summ.push(['Avg pace', P(A.easy.movePace) + PU()]);
    const sumHtml = summ.map(([k, v]) => `<div class="kv-i"><span>${k}</span><b>${v}</b></div>`).join('');
    const repsTbl = A.mode === 'intervals' ? repTables(A, m) : '';
    const charts = `<section class="card"><h2>Timeline</h2>${timelineChart(A, m)}<div class="legend"><span><i class="l pace"></i>Pace</span><span><i class="l hr"></i>Heart rate</span><span><i class="l tgt"></i>Target pace</span><span><i class="l lthr"></i>LTHR</span><span><i class="sw"></i>Detected rep</span></div></section>`;
    const repCharts = A.mode === 'intervals' ? `<div class="grid two"><section class="card"><h2>Pace vs target</h2>${devChart(A)}<p class="hint">Dots inside the green band are on target (−1.5% … +3%). Negative = faster than target, positive = slower.</p></section><section class="card"><h2>End-of-rep HR</h2>${hrChart(A, m)}<p class="hint">Shaded band = expected finish HR for that rep (10–15 bpm under LTHR early, approaching LTHR late).</p></section></div>` : '';
    const f = A.findings.map((x) => `<li class="f ${x.type}"><i></i><span>${esc(x.text)}</span></li>`).join('');
    const s = A.suggestions.map((x) => `<li>${esc(x)}</li>`).join('');
    const detOpts = `<details class="card opts"><summary>Detection options <span class="muted">· ${A.mode === 'intervals' ? 'detected via ' + (A.method === 'laps' ? 'workout steps/laps' : 'pace changes') : 'no intervals detected'}</span></summary>
      <div class="opts-grid">
        <div class="field"><label for="o-sens">Sensitivity</label><input id="o-sens" type="range" min="-1" max="1" step="0.1" value="${aOpts.sensitivity}"><p class="hint">Move left if easy parts are being counted as reps; right if short/slow reps are being missed.</p></div>
        <div class="field"><label for="o-force">Treat as</label><select id="o-force"><option value="auto"${aOpts.force === 'auto' ? ' selected' : ''}>Auto-detect</option><option value="easy"${aOpts.force === 'easy' ? ' selected' : ''}>Easy / steady run</option></select></div>
        <div class="field"><label for="o-detect">Rep boundaries from</label><select id="o-detect"><option value="auto"${aOpts.detect === 'auto' ? ' selected' : ''}>Workout steps if available, else pace</option><option value="speed"${aOpts.detect === 'speed' ? ' selected' : ''}>Pace changes only</option></select></div>
        <label class="check"><input id="o-gap" type="checkbox" ${runOpts().gradeAdjust ? 'checked' : ''}> Grade-adjust pace on hills</label>
      </div></details>`;
    return `
    <section class="card score-card">
      <div class="score-left">${ring(A.scores.total, A.verdict.tone)}<div><div class="verdict ${A.verdict.tone}">${esc(A.verdict.label)}</div><div class="sub">${esc(current.fileName || t.name)}${date ? ' · ' + esc(date) : ''}</div><div class="sub">${esc(t.format)}${t.sport ? ' · ' + esc(t.sport) : ''} · scored vs LTHR ${m.hr.lthr} &amp; VDOT ${m.fit.vdot.toFixed(1)}</div></div></div>
      <div class="bars">${bars}</div>
    </section>
    <section class="card"><h2>Summary</h2><div class="kv-grid">${sumHtml}</div></section>
    ${detOpts}
    ${charts}${repCharts}${repsTbl}
    <div class="grid two"><section class="card"><h2>Insights</h2><ul class="findings">${f}</ul></section><section class="card"><h2>Suggestions</h2><ul class="sugg">${s}</ul></section></div>
    ${aiCard()}`;
  }
  function repTables(A, m) {
    const rows = A.reps.map((r) => {
      const cls = r.paceScore >= 95 ? 'g' : r.paceScore >= 80 ? 'a' : 'r';
      const hrc = !isNum(r.hrScore) ? '' : r.hrScore >= 95 ? 'g' : r.hrScore >= 80 ? 'a' : 'r';
      return `<tr><td>${r.idx}</td><td class="mono">${fmtT(r.dur)}</td><td class="mono">${dist(r.dist).replace(' km', '').replace(' mi', '')}</td><td class="mono b">${P(r.adjPace)}${Math.abs(r.adjPace - r.pace) > 1 ? '<sup title="grade-adjusted; raw ' + P(r.pace) + '">*</sup>' : ''}</td><td class="mono muted">${P(r.target)}</td><td><span class="pill ${cls}">${(r.dev > 0 ? '+' : '') + (r.dev * 100).toFixed(1)}%</span></td><td class="mono">${isNum(r.hrAvg) ? Math.round(r.hrAvg) : '–'}</td><td class="mono">${isNum(r.endHr) ? `<span class="pill ${hrc}">${Math.round(r.endHr)}</span>` : '–'}</td><td class="mono muted">${Math.round(r.endBand.lo)}–${Math.round(r.endBand.hi)}</td></tr>`;
    }).join('');
    const rr = A.rests.map((r) => `<tr><td>${r.idx}</td><td class="mono">${Math.round(r.dur)} s</td><td class="mono muted">${r.win.lo}–${r.win.hi} s</td><td class="mono">${P(r.pace)}</td><td class="mono">${isNum(r.hrDrop) ? '−' + Math.round(r.hrDrop) + ' bpm' : '–'}</td><td><span class="pill ${r.score >= 95 ? 'g' : r.score >= 80 ? 'a' : 'r'}">${Math.round(r.score)}</span></td></tr>`).join('');
    return `<section class="card"><h2>Reps</h2><div class="tbl-wrap"><table class="tbl dense"><thead><tr><th>#</th><th>Time</th><th>${unit() === 'mi' ? 'mi' : 'km'}</th><th>Pace${PU()}</th><th>Target</th><th>Dev</th><th>Avg HR</th><th>End HR</th><th>Expect</th></tr></thead><tbody>${rows}</tbody></table></div></section>
      ${A.rests.length ? `<section class="card"><h2>Recoveries</h2><div class="tbl-wrap"><table class="tbl dense"><thead><tr><th>#</th><th>Length</th><th>Window</th><th>Pace${PU()}</th><th>HR drop</th><th>Score</th></tr></thead><tbody>${rr}</tbody></table></div></section>` : ''}`;
  }

  /* ---------- charts (inline SVG) ---------- */
  function timelineChart(A, m) {
    const mob = LAYOUT === 'mobile';
    const W = mob ? 440 : 820, H = mob ? 320 : 300, L = mob ? 40 : 46, R = mob ? 30 : 42, T = 16, B = 28, iw = W - L - R, ih = H - T - B;
    const S = A.series, dur = A.totals.durSec;
    const paces = S.map((p) => (p.v > 0.8 ? 1000 / p.v : null));
    const valid = paces.filter(isNum).sort((a, b) => a - b);
    if (valid.length < 5) return '<p class="hint">No pace data.</p>';
    let pMin = valid[Math.floor(valid.length * 0.02)] * 0.96, pMax = valid[Math.floor(valid.length * 0.98)] * 1.04;
    if (A.reps) A.reps.forEach((r) => { pMin = Math.min(pMin, r.target * 0.97, r.pace * 0.97); });
    pMax = Math.min(pMax, 720);
    const x = (t) => L + t / dur * iw, yP = (p) => T + (Math.min(Math.max(p, pMin), pMax) - pMin) / (pMax - pMin) * ih;
    // faster (small pace) on top
    const hrs = S.map((p) => p.hr).filter(isNum);
    const hMin = hrs.length ? Math.min(...hrs) - 4 : 0, hMax = hrs.length ? Math.max(...hrs, m.hr.lthr) + 4 : 1;
    const yH = (h) => T + (1 - (h - hMin) / (hMax - hMin)) * ih;
    let g = '';
    if (A.reps) A.reps.forEach((r) => { g += `<rect class="rep" x="${x(r.a).toFixed(1)}" y="${T}" width="${Math.max(1, x(r.b) - x(r.a)).toFixed(1)}" height="${ih}"/><text class="rn" x="${((x(r.a) + x(r.b)) / 2).toFixed(1)}" y="${T + 11}" text-anchor="middle">${r.idx}</text>`; });
    // grid + axes
    const stepT = dur > 5400 ? 1200 : dur > 2400 ? 600 : 300;
    for (let t = 0; t <= dur; t += stepT) g += `<line class="grid" x1="${x(t)}" x2="${x(t)}" y1="${T}" y2="${T + ih}"/><text class="ax" x="${x(t)}" y="${H - 8}" text-anchor="middle">${Math.round(t / 60)}′</text>`;
    const pStep = (pMax - pMin) > 150 ? 60 : (pMax - pMin) > 70 ? 30 : 15;
    const startTick = Math.ceil(pMin / pStep) * pStep;
    for (let p = startTick; p <= pMax; p += pStep) g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${yP(p)}" y2="${yP(p)}"/><text class="ax" x="${L - 6}" y="${yP(p) + 3}" text-anchor="end">${P(p)}</text>`;
    // pace path
    let d = ''; let pen = false;
    S.forEach((p, i) => { const pc = paces[i]; if (!isNum(pc)) { pen = false; return; } d += (pen ? 'L' : 'M') + x(p.t).toFixed(1) + ' ' + yP(pc).toFixed(1); pen = true; });
    g += `<path class="line pace" d="${d}"/>`;
    // targets
    if (A.reps) A.reps.forEach((r) => { g += `<line class="tgt" x1="${x(r.a)}" x2="${x(r.b)}" y1="${yP(r.target)}" y2="${yP(r.target)}"/>`; });
    if (hrs.length) {
      let dh = '', pn = false; S.forEach((p) => { if (!isNum(p.hr)) { pn = false; return; } dh += (pn ? 'L' : 'M') + x(p.t).toFixed(1) + ' ' + yH(p.hr).toFixed(1); pn = true; });
      g += `<path class="line hr" d="${dh}"/>`;
      g += `<line class="lthr" x1="${L}" x2="${W - R}" y1="${yH(m.hr.lthr)}" y2="${yH(m.hr.lthr)}"/><text class="ax hrt" x="${W - R + 5}" y="${yH(m.hr.lthr) + 3}">${m.hr.lthr}</text>`;
      for (let h = Math.ceil(hMin / 10) * 10; h <= hMax; h += 20) g += `<text class="ax hrt" x="${W - R + 5}" y="${yH(h) + 3}">${h}</text>`;
    }
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Pace and heart rate timeline" preserveAspectRatio="xMidYMid meet">${g}</svg>`;
  }
  function devChart(A) {
    const n = A.reps.length, W = 420, H = 210, L = 38, R = 12, T = 12, B = 26, iw = W - L - R, ih = H - T - B;
    const devs = A.reps.map((r) => r.dev * 100);
    const lim = Math.max(6, Math.ceil(Math.max(...devs.map(Math.abs)) / 2) * 2);
    const y = (v) => T + (v + lim) / (2 * lim) * ih;   // negative (faster) on top
    const xx = (i) => L + (n === 1 ? iw / 2 : (i + 0.5) / n * iw);
    let g = `<rect class="band" x="${L}" y="${y(-1.5)}" width="${iw}" height="${y(3) - y(-1.5)}"/>`;
    for (let v = -lim; v <= lim; v += lim / 2) g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 5}" y="${y(v) + 3}" text-anchor="end">${(v > 0 ? '+' : '') + v.toFixed(0)}%</text>`;
    g += `<text class="ax" x="${L + 4}" y="${T + 10}">faster ↑</text><text class="ax" x="${L + 4}" y="${T + ih - 4}">slower ↓</text>`;
    g += `<line class="zero" x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}"/>`;
    A.reps.forEach((r, i) => {
      const c = r.paceScore >= 95 ? 'g' : r.paceScore >= 80 ? 'a' : 'r';
      g += `<line class="stem ${c}" x1="${xx(i)}" x2="${xx(i)}" y1="${y(0)}" y2="${y(devs[i])}"/><circle class="dot ${c}" cx="${xx(i)}" cy="${y(devs[i])}" r="5"/><text class="ax" x="${xx(i)}" y="${H - 8}" text-anchor="middle">${r.idx}</text>`;
    });
    return `<svg class="chart sm" viewBox="0 0 ${W} ${H}" role="img" aria-label="Rep pace deviation from target">${g}</svg>`;
  }
  function hrChart(A, m) {
    if (!A.totals.hasHr) return '<p class="hint">No heart-rate data in this file.</p>';
    const n = A.reps.length, W = 420, H = 210, L = 38, R = 12, T = 12, B = 26, iw = W - L - R, ih = H - T - B;
    const vals = A.reps.map((r) => r.endHr).filter(isNum).concat(A.reps.flatMap((r) => [r.endBand.lo, r.endBand.hi]), [m.hr.lthr]);
    const lo = Math.floor(Math.min(...vals) / 5) * 5 - 5, hi = Math.ceil(Math.max(...vals) / 5) * 5 + 5;
    const y = (v) => T + (1 - (v - lo) / (hi - lo)) * ih, xx = (i) => L + (n === 1 ? iw / 2 : (i + 0.5) / n * iw);
    let g = '';
    for (let v = Math.ceil(lo / 10) * 10; v <= hi; v += 10) g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 5}" y="${y(v) + 3}" text-anchor="end">${v}</text>`;
    const bw = iw / n * 0.7;
    A.reps.forEach((r, i) => { g += `<rect class="band" x="${xx(i) - bw / 2}" y="${y(r.endBand.hi)}" width="${bw}" height="${Math.max(2, y(r.endBand.lo) - y(r.endBand.hi))}"/>`; });
    g += `<line class="lthr" x1="${L}" x2="${W - R}" y1="${y(m.hr.lthr)}" y2="${y(m.hr.lthr)}"/>`;
    A.reps.forEach((r, i) => { if (!isNum(r.endHr)) return; const c = r.hrScore >= 95 ? 'g' : r.hrScore >= 80 ? 'a' : 'r'; g += `<circle class="dot ${c}" cx="${xx(i)}" cy="${y(r.endHr)}" r="5"/><text class="ax" x="${xx(i)}" y="${H - 8}" text-anchor="middle">${r.idx}</text>`; });
    return `<svg class="chart sm" viewBox="0 0 ${W} ${H}" role="img" aria-label="End-of-rep heart rate vs expected band">${g}</svg>`;
  }

  /* ---------- AI card ---------- */
  function aiCard() {
    const ai = state.ai, has = ai.provider === 'compat' || ai.key;
    const c = current.ai;
    const out = c && c.text ? `<div class="ai-out md">${NSA.AI.mdToHtml(c.text)}</div>
      <div class="ai-follow"><input id="ai-q" type="text" placeholder="Ask a follow-up (e.g. “How should I progress next week?”)"><button class="btn" data-act="ai-follow">Ask</button></div>` : '';
    return `<section class="card ai" id="ai-card">
      <h2>✨ AI coach</h2>
      <p class="hint" style="margin-top:0">${has ? 'Sends only a numeric summary of this workout, your LTHR and paces to <b>' + esc(NSA.AI.PROVIDERS[ai.provider].label) + '</b>.' : 'Add an API key in <button class="link" data-act="tab" data-tab="settings">Settings</button> for built-in coaching — or copy the prompt into ChatGPT/Claude yourself.'}</p>
      <textarea id="ai-notes" rows="2" placeholder="Optional: how did it feel? heat, hills, sleep, shoes, illness…"></textarea>
      <div class="btn-row"><button class="btn primary" data-act="ai-run" ${c && c.busy ? 'disabled' : ''}>${c && c.busy ? 'Thinking…' : 'Get AI coaching'}</button><button class="btn" data-act="ai-copy">Copy prompt</button></div>
      ${c && c.error ? `<p class="banner err">${esc(c.error)}</p>` : ''}${out}</section>`;
  }
  async function runAi(follow) {
    const m = getModel(); const cur = current;
    const notes = ($('#ai-notes') || {}).value || '';
    cur.ai = cur.ai || { messages: [] };
    const ai = cur.ai; ai.error = null;
    const pr = NSA.AI.buildPrompt(cur.A, m, unit(), notes);
    if (follow) {
      const q = ($('#ai-q') || {}).value; if (!q || !q.trim()) return;
      ai.messages.push({ role: 'user', content: q.trim() });
    } else ai.messages = [{ role: 'user', content: pr.user }];
    ai.busy = true; rerenderAi();
    try {
      const text = await NSA.AI.chat(state.ai, pr.system, ai.messages);
      if (!text) throw new Error('The AI returned an empty response.');
      ai.messages.push({ role: 'assistant', content: text });
      ai.text = follow ? (ai.text + '\n\n---\n\n**You:** ' + ai.messages[ai.messages.length - 2].content + '\n\n' + text) : text;
    } catch (e) { ai.error = e.message || String(e); if (follow) ai.messages.pop(); }
    ai.busy = false; rerenderAi();
  }
  function rerenderAi() {
    const card = $('#ai-card'); if (!card) return;
    const notes = ($('#ai-notes') || {}).value;
    const tmp = document.createElement('div'); tmp.innerHTML = aiCard(); card.replaceWith(tmp.firstElementChild);
    if (notes) $('#ai-notes').value = notes;
  }
  function bindResult() {
    const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
    on('#o-sens', 'change', (e) => { aOpts.sensitivity = parseFloat(e.target.value); reanalyze(); });
    on('#o-force', 'change', (e) => { aOpts.force = e.target.value; reanalyze(); });
    on('#o-detect', 'change', (e) => { aOpts.detect = e.target.value; reanalyze(); });
    on('#o-gap', 'change', (e) => { aOpts.gradeAdjust = e.target.checked; reanalyze(); });
  }

  /* ----------------------------- HISTORY ---------------------------- */
  function viewHistory() {
    const H = state.history;
    if (!H.length) return `<div class="page-head"><h1>History</h1></div><section class="card"><p class="empty">No analysed workouts yet. Upload one on the <button class="link" data-act="tab" data-tab="analyze">Analyze</button> tab — scores are saved here automatically.</p></section>`;
    const avg = Math.round(H.reduce((s, h) => s + h.score, 0) / H.length);
    const rows = H.slice().reverse().map((h) => `<li class="hist-row"><div class="hscore ${h.tone}">${h.score}</div><div class="hmain"><b>${esc(h.label)}</b><div class="sub">${new Date(h.ts).toLocaleDateString([], { dateStyle: 'medium' })} · ${(h.distM / 1000).toFixed(1)} km · ${fmtT(h.durSec)}${isNum(h.avgHr) ? ' · ' + Math.round(h.avgHr) + ' bpm' : ''}${h.dev != null ? ' · pace ' + (h.dev > 0 ? '+' : '') + (h.dev * 100).toFixed(1) + '% vs target' : ''}</div><div class="sub muted">${esc(h.verdict)} · ${esc(h.name)}</div></div><button class="icon-btn" data-act="del-hist" data-id="${esc(h.id)}" aria-label="Delete">×</button></li>`).join('');
    return `<div class="page-head"><h1>History</h1><p class="lead">${H.length} workout${H.length > 1 ? 's' : ''} · average score ${avg}</p></div>
      <section class="card"><h2>Score trend</h2>${trendChart(H)}</section>
      <section class="card"><ul class="hist">${rows}</ul><p><button class="btn danger" data-act="clear-hist">Clear history</button></p></section>`;
  }
  function trendChart(H) {
    const W = 820, Ht = 190, L = 34, R = 14, T = 12, B = 24, iw = W - L - R, ih = Ht - T - B, n = H.length;
    const x = (i) => L + (n === 1 ? iw / 2 : i / (n - 1) * iw), y = (v) => T + (1 - v / 100) * ih;
    let g = '';
    [50, 70, 85, 100].forEach((v) => { g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 5}" y="${y(v) + 3}" text-anchor="end">${v}</text>`; });
    g += `<path class="line pace" d="${H.map((h, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(h.score).toFixed(1)).join('')}"/>`;
    H.forEach((h, i) => { g += `<circle class="dot ${h.score >= 85 ? 'g' : h.score >= 70 ? 'a' : 'r'}" cx="${x(i)}" cy="${y(h.score)}" r="4.5"><title>${esc(h.label)} — ${h.score}</title></circle>`; });
    const idxs = n <= 6 ? H.map((_, i) => i) : [0, Math.floor(n / 2), n - 1];
    idxs.forEach((i) => { g += `<text class="ax" x="${x(i)}" y="${Ht - 6}" text-anchor="middle">${new Date(H[i].ts).toLocaleDateString([], { month: 'short', day: 'numeric' })}</text>`; });
    return `<svg class="chart" viewBox="0 0 ${W} ${Ht}" role="img" aria-label="Score trend">${g}</svg>`;
  }

  /* ----------------------------- SETTINGS --------------------------- */
  function viewSettings() {
    const a = state.ai, pr = NSA.AI.PROVIDERS;
    const opts = Object.keys(pr).map((k) => `<option value="${k}"${a.provider === k ? ' selected' : ''}>${pr[k].label}</option>`).join('');
    return `<div class="page-head"><h1>Settings</h1></div>
    <div class="grid two">
    <section class="card"><h2>AI coach</h2>
      <p class="hint" style="margin-top:0">Bring your own API key. It is kept only in this browser. Requests go straight from your device to the provider you pick.</p>
      <div class="field"><label for="s-prov">Provider</label><select id="s-prov">${opts}</select></div>
      <div class="field"><label for="s-model">Model <span class="opt">(blank = ${esc(pr[a.provider].model || 'required')})</span></label><input id="s-model" type="text" value="${esc(a.model)}" placeholder="${esc(pr[a.provider].model)}" autocomplete="off"></div>
      <div class="field" id="s-base-wrap" ${a.provider === 'compat' ? '' : 'hidden'}><label for="s-base">Base URL</label><input id="s-base" type="text" value="${esc(a.baseUrl)}" placeholder="https://openrouter.ai/api/v1"></div>
      <div class="field"><label for="s-key">API key</label><input id="s-key" type="password" value="${esc(a.key)}" placeholder="${esc(pr[a.provider].keyHint)}" autocomplete="off"></div>
      <label class="check"><input id="s-rem" type="checkbox" ${a.remember ? 'checked' : ''}> Remember key on this device</label>
      <p class="hint">Tip: set a spend limit on the key. Don’t use the saved-key option on shared computers.</p>
    </section>
    <section class="card"><h2>Your data</h2>
      <p class="hint" style="margin-top:0">Inputs and history are saved automatically in this browser${storageOk ? '' : ' <b>(storage looks blocked — changes won’t persist)</b>'}. Export a backup to move to another device or browser.</p>
      <div class="btn-row"><button class="btn" data-act="export">Export backup</button><label class="btn" for="imp">Import backup<input id="imp" type="file" accept="application/json,.json" hidden></label><button class="btn danger" data-act="reset">Reset everything</button></div>
      <h3 style="margin-top:1.4em">Install${LAYOUT === 'mobile' ? ' on your phone' : ''}</h3>
      <p class="hint" style="margin-top:.2em">${LAYOUT === 'mobile' ? 'Open this page in Chrome/Safari → Share / ⋮ menu → “Add to Home Screen”. It then works offline.' : 'This single HTML file works offline — keep it anywhere and double-click to open. Use the same browser each time so your saved inputs are found, or use Export/Import to move them.'}</p>
    </section></div>
    <section class="card"><h2>Method &amp; sources</h2>
      <div class="md small">
      <p><b>Paces.</b> Your race result is converted to a Daniels VDOT. Each rep length is then mapped on the <i>Norwegian Singles</i> guide curve — ≈3 min ↔ 12–15K pace, ≈6 min ↔ 20K/half-marathon pace, ≈10 min ↔ 25–30K pace — and interpolated/extrapolated for any other duration (never faster than 10K or slower than marathon pace). The “Blend” model averages that with James Copeland’s 5K-based pace table (3/6/10-minute reps and easy pace). The two agree within ~3–10 s/km across 15–30 min 5K runners.</p>
      <p><b>Heart rate.</b> Early reps finish ~10–15 bpm below LTHR and later reps approach LTHR from below; repeatedly exceeding LTHR means the pace should come down. Average HR over a rep sits below the end-of-rep HR because HR lags (more so for short reps). Easy runs: average HR ≲ 70% of max HR (estimated as LTHR ÷ 0.91 if you don’t enter one). Zones follow Friel’s %LTHR running model.</p>
      <p><b>Recoveries.</b> ~60 s for 3-min reps, 60–90 s for 6-min, 90–120 s for 10-min; scaled for other rep lengths. Shortening rests is not a progression target.</p>
      <p><b>Scoring (0–100).</b> Pace vs target 35 · Heart-rate control 25 · Consistency 20 · Recoveries 10 · Structure (warm-up, cool-down, 24–40 min of work) 10. Easy runs are scored on average HR, time over the HR cap, pace and cardiac drift. Weights are re-normalised if a component can’t be measured (e.g. no HR).</p>
      <p><b>Interval detection.</b> Rep boundaries come from workout steps/laps when the file has them (FIT/TCX), otherwise from pace changes using a 2-cluster split — so any rep length, ladders and custom sets work. Warm-up and cool-down are whatever precedes/follows the main set.</p>
      <p class="muted">Sources: <a href="https://norwegiansingles.run/section1_core_principles.html" target="_blank" rel="noopener">norwegiansingles.run</a> (Norwegian Singles guide) · Copeland/Zimmerman, <i>Norwegian Singles Method</i> (5K-based table, via <a href="https://fwdmotionsthlm-newsletter.beehiiv.com/p/norwegian-singles-explained" target="_blank" rel="noopener">this explainer</a>) · <a href="https://marathonhandbook.com/norwegian-singles-training/" target="_blank" rel="noopener">Marathon Handbook</a> · Daniels &amp; Gilbert VDOT · Friel LTHR zones.</p>
      <p class="muted">Guidance only — not medical or coaching advice. Pace and HR targets are estimates; adjust for heat, hills, fatigue, and how you feel. NSA PACER v${APP_VERSION}.</p></div>
    </section>`;
  }
  function bindSettings() {
    const a = state.ai;
    $('#s-prov').addEventListener('change', (e) => { a.provider = e.target.value; a.model = ''; save(); renderView(); });
    $('#s-model').addEventListener('input', (e) => { a.model = e.target.value; save(); });
    $('#s-base').addEventListener('input', (e) => { a.baseUrl = e.target.value; save(); });
    $('#s-key').addEventListener('input', (e) => { a.key = e.target.value; save(); });
    $('#s-rem').addEventListener('change', (e) => { a.remember = e.target.checked; save(); });
    $('#imp').addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { const j = JSON.parse(await f.text()); if (!j.profile) throw new Error('Not an NSA Pacer backup'); Object.assign(state.profile, j.profile); if (j.history) state.history = j.history; if (j.calc) Object.assign(state.calc, j.calc); if (j.ai) Object.assign(state.ai, j.ai); save(); toast('Backup imported.'); renderNav(); renderView(); }
      catch (err) { toast('Import failed: ' + err.message, 'err'); }
    });
  }

  /* ----------------------------- actions ---------------------------- */
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.getAttribute('data-act');
    switch (act) {
      case 'tab': go(b.getAttribute('data-tab')); break;
      case 'add-race': {
        const id = $('#rf-dist').value, t = NSA.parseTime($('#rf-time').value), date = $('#rf-date').value, name = $('#rf-name').value.trim();
        const r = { uid: uid(), id, customKm: parseFloat($('#rf-custom').value) || 0, timeSec: t, date, name };
        if (!(t >= 60)) { toast('Enter a finish time like 20:00 or 1:35:30.', 'err'); break; }
        if (id === 'custom' && !(r.customKm > 0.4)) { toast('Enter the custom distance in km.', 'err'); break; }
        const v = NSA.raceVdot(r);
        if (!(v > 15 && v < 90)) { toast('That time looks implausible for the distance — check it.', 'err'); break; }
        state.profile.races.push(r); state.profile.primaryRaceId = null; save(); renderView(); toast('Result added.'); break;
      }
      case 'del-race': state.profile.races = state.profile.races.filter((r) => r.uid !== b.getAttribute('data-id')); if (state.profile.primaryRaceId === b.getAttribute('data-id')) state.profile.primaryRaceId = null; save(); renderView(); break;
      case 'del-hist': state.history = state.history.filter((h) => h.id !== b.getAttribute('data-id')); save(); renderView(); break;
      case 'clear-hist': if (confirm('Delete all saved workout scores?')) { state.history = []; save(); renderView(); } break;
      case 'ai-run': runAi(false); break;
      case 'ai-follow': runAi(true); break;
      case 'ai-copy': {
        const m = getModel(); const pr = NSA.AI.buildPrompt(current.A, m, unit(), ($('#ai-notes') || {}).value || '');
        try { await navigator.clipboard.writeText(pr.plain); toast('Prompt copied — paste it into ChatGPT, Claude or Gemini.'); }
        catch (err) { const ta = document.createElement('textarea'); ta.value = pr.plain; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); toast('Prompt copied.'); } catch (e2) { toast('Could not copy automatically.', 'err'); } ta.remove(); }
        break;
      }
      case 'export': {
        const copy = JSON.parse(JSON.stringify(state)); delete copy.prefs; if (copy.ai) copy.ai.key = '';
        const blob = new Blob([JSON.stringify(copy, null, 2)], { type: 'application/json' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'nsa-pacer-backup-' + todayStr() + '.json'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        toast('Backup downloaded (API key excluded).'); break;
      }
      case 'reset': if (confirm('Reset all inputs, history and settings on this device?')) { try { localStorage.removeItem(LS_KEY); } catch (e2) {} location.reload(); } break;
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.id === 'ai-q') { e.preventDefault(); runAi(true); }
    if (e.key === 'Enter' && ['rf-time', 'rf-name', 'rf-custom'].includes(e.target.id)) { e.preventDefault(); const b = $('[data-act=add-race]'); if (b) b.click(); }
  });
  $('#unit-toggle').addEventListener('click', () => { state.profile.unit = unit() === 'km' ? 'mi' : 'km'; save(); renderNav(); renderView(); if (current && tab === 'analyze') reanalyze(); });

  /* ----------------------------- boot ------------------------------- */
  const m0 = getModel();
  tab = state.prefs.tab && TABS.some((t) => t[0] === state.prefs.tab) ? state.prefs.tab : (m0 && m0.fit ? 'paces' : 'inputs');
  if (!(m0 && m0.fit) && tab !== 'settings') tab = 'inputs';
  renderNav(); renderView();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http') && LAYOUT === 'mobile') navigator.serviceWorker.register('./sw.js').catch(() => {});
  window.__nsa = { state, getModel, handleFiles, get current() { return current; }, go };
})();
