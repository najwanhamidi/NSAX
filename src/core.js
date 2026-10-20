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
