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
