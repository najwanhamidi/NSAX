// Build script: node build.js  -> out/mobile (GitHub Pages) + out/desktop (single standalone HTML)
const fs = require('fs'), path = require('path');
const SRC = path.join(__dirname, 'src'), OUT = path.join(__dirname, 'out');
const VERSION = require('./package.json').version;
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');
const js = ['core.js', 'parsers.js', 'analyze.js', 'ai.js', 'ui.js'].map(read).join('\n;\n');
const css = read('style.css');
const logo = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13.5" r="7"/><path d="M12 13.5V9.5M9.5 3h5M12 3v3.5"/></svg>';
const head = (title) => `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${title}</title><meta name="description" content="Norwegian Singles Approach pace and heart-rate calculator with AI workout analysis"><meta name="color-scheme" content="light dark"><meta name="theme-color" content="#d62839">`;
const topbar = `<header class="top"><div class="brand"><span class="logo">${logo}</span><span>NSA Pacer<small>Norwegian Singles</small></span></div><span class="grow"></span><button id="unit-toggle" class="pill-btn" aria-label="Toggle pace units">min/km</button></header>`;
const toast = '<div id="toast" class="toast" role="status" aria-live="polite"></div>';
const noscript = '<noscript><p style="padding:1rem">This app needs JavaScript.</p></noscript>';

// ---- mobile (GitHub Pages)
const mob = path.join(OUT, 'mobile'); fs.mkdirSync(mob, { recursive: true });
fs.writeFileSync(path.join(mob, 'index.html'), `<!doctype html><html lang="en"><head>${head('NSA Pacer')}
<link rel="manifest" href="manifest.webmanifest"><link rel="icon" href="icon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="icon-192.png">
<meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="NSA Pacer"><meta name="apple-mobile-web-app-status-bar-style" content="default">
<link rel="stylesheet" href="style.css?v=${VERSION}"></head>
<body data-layout="mobile">${topbar}<main id="view"></main><nav id="nav" aria-label="Sections"></nav>${toast}${noscript}
<script src="app.js?v=${VERSION}"></script></body></html>`);
fs.writeFileSync(path.join(mob, 'app.js'), js);
fs.writeFileSync(path.join(mob, 'style.css'), css);
fs.writeFileSync(path.join(mob, 'manifest.webmanifest'), JSON.stringify({
  name: 'NSA Pacer — Norwegian Singles', short_name: 'NSA Pacer', description: 'Norwegian Singles pace & heart-rate calculator with workout analysis',
  start_url: './', scope: './', display: 'standalone', background_color: '#f4f2ec', theme_color: '#d62839',
  icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' }, { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }, { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' }],
}, null, 2));
fs.writeFileSync(path.join(mob, 'sw.js'), `const CACHE='nsa-pacer-${VERSION}';
const FILES=['./','./index.html','./app.js?v=${VERSION}','./style.css?v=${VERSION}','./manifest.webmanifest','./icon.svg','./icon-192.png','./icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==location.origin)return;
e.respondWith(caches.match(e.request,{ignoreSearch:false}).then(r=>r||fetch(e.request).then(res=>{const cp=res.clone();caches.open(CACHE).then(c=>c.put(e.request,cp));return res}).catch(()=>caches.match('./index.html'))))});
`);
fs.writeFileSync(path.join(mob, '.nojekyll'), '');
for (const f of ['icon-192.png','icon-512.png']) fs.copyFileSync(path.join(SRC, f), path.join(mob, f));
fs.writeFileSync(path.join(mob, 'icon.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#d62839"/><g fill="none" stroke="#fff" stroke-width="30" stroke-linecap="round" stroke-linejoin="round"><circle cx="256" cy="290" r="130"/><path d="M256 290v-80M210 96h92M256 96v54"/></g></svg>`);

// ---- desktop (single standalone HTML)
const dsk = path.join(OUT, 'desktop'); fs.mkdirSync(dsk, { recursive: true });
fs.writeFileSync(path.join(dsk, 'NSA-Pacer-Desktop.html'), `<!doctype html><html lang="en"><head>${head('NSA Pacer — Desktop')}
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#d62839"/><g fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"><circle cx="32" cy="36" r="16"/><path d="M32 36v-9M27 12h10M32 12v6"/></g></svg>')}">
<style>${css}</style></head>
<body data-layout="desktop">${topbar}<div class="shell"><nav id="nav" aria-label="Sections"></nav><main id="view"></main></div>${toast}${noscript}
<script>${js.replace(/<\/script>/g, '<\\/script>')}</script></body></html>`);
console.log('built', VERSION, fs.readdirSync(mob), fs.statSync(path.join(dsk, 'NSA-Pacer-Desktop.html')).size + ' bytes desktop');
