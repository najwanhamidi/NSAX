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
