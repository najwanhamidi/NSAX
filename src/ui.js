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
