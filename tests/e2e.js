const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const path = require('path'); const fs=require('fs');
const target = process.argv[2], layout = process.argv[3] || 'mobile';
const shotDir = path.join(__dirname, 'shots'); fs.mkdirSync(shotDir,{recursive:true});
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(()=>chromium.launch());
  const ctx = await browser.newContext(layout==='mobile'?{viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true}:{viewport:{width:1440,height:900}});
  const page = await ctx.newPage();
  const errs=[]; page.on('console',m=>{ if(['error','warning'].includes(m.type())) errs.push(m.type()+': '+m.text()); }); page.on('pageerror',e=>errs.push('PAGEERR '+e.message));
  await page.goto(target); await page.waitForTimeout(400);
  await page.screenshot({path:`${shotDir}/${layout}-1-inputs-empty.png`});
  // set inputs
  await page.fill('#in-lthr','178');
  await page.selectOption('#rf-dist','5k'); await page.fill('#rf-time','20:00'); await page.click('[data-act=add-race]');
  await page.waitForTimeout(200);
  await page.screenshot({path:`${shotDir}/${layout}-2-inputs.png`,fullPage:true});
  await page.click('[data-tab=paces]'); await page.waitForTimeout(200);
  await page.screenshot({path:`${shotDir}/${layout}-3-paces.png`,fullPage:true});
  await page.click('[data-tab=analyze]');
  const files = ['10x3_good.gpx','10x3_good.tcx','10x3_good.fit','10x3_structured.fit','5x6_toofast.gpx','3x10_good.fit','ladder_custom.gpx','8x4min_custom.gpx','easy60.gpx'];
  for (const f of files) {
    await page.setInputFiles('#file', path.join(__dirname,'data',f));
    await page.waitForSelector('.score-card',{timeout:20000}); await page.waitForTimeout(300);
    const info = await page.evaluate(()=>{const A=window.__nsa.current.A;return {mode:A.mode,method:A.method,set:A.set&&A.set.label,score:A.scores.total,v:A.verdict.label,parts:A.scores.parts.map(p=>p.id+':'+p.score).join(' '),n:A.reps&&A.reps.length,rests:A.rests&&A.rests.length}});
    console.log(f.padEnd(24),JSON.stringify(info));
    if (['10x3_good.gpx','5x6_toofast.gpx','ladder_custom.gpx','easy60.gpx'].includes(f)) await page.screenshot({path:`${shotDir}/${layout}-4-${f}.png`,fullPage:true});
  }
  await page.click('[data-tab=history]'); await page.waitForTimeout(200);
  await page.screenshot({path:`${shotDir}/${layout}-5-history.png`,fullPage:true});
  await page.click('[data-tab=settings]'); await page.waitForTimeout(200);
  await page.screenshot({path:`${shotDir}/${layout}-6-settings.png`,fullPage:true});
  // persistence: reload
  await page.reload(); await page.waitForTimeout(300);
  const persisted = await page.evaluate(()=>({lthr:window.__nsa.state.profile.lthr,races:window.__nsa.state.profile.races.length,hist:window.__nsa.state.history.length}));
  console.log('after reload',JSON.stringify(persisted));
  console.log('console issues:',errs.length?errs.join('\n'):'none');
  await browser.close();
})();
