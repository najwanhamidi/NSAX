const { chromium } = require('/opt/npm-tools/node_modules/playwright'); const path=require('path');
(async()=>{
 const b=await chromium.launch(); const p=await (await b.newContext({viewport:{width:1300,height:900}})).newPage();
 const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>m.type()==='error'&&errs.push(m.text()));
 await p.goto('file:///home/claude/nsa/out/desktop/NSA-Pacer-Desktop.html');
 await p.fill('#in-lthr','178'); await p.selectOption('#rf-dist','5k'); await p.fill('#rf-time','20:00'); await p.click('[data-act=add-race]');
 await p.click('[data-tab=analyze]');
 for (const f of ['edge_strides_walkrest_nohr.gpx','10x3_good.fit.gz']) {
  await p.setInputFiles('#file',path.join(__dirname,'data',f)); await p.waitForSelector('.score-card'); 
  console.log(f, await p.evaluate(()=>{const A=window.__nsa.current.A;return JSON.stringify({mode:A.mode,set:A.set&&A.set.label,strides:A.strides,score:A.scores.total,parts:A.scores.parts.map(x=>x.id+':'+x.score),wu:A.warmup&&Math.round(A.warmup.dur),f:A.findings.map(x=>x.type+': '+x.text.slice(0,90))},null,0)}));
 }
 // AI mock
 await p.route('https://api.anthropic.com/**', async r=>{ const req=r.request(); console.log('AI headers ok:', req.headers()['x-api-key'], req.headers()['anthropic-dangerous-direct-browser-access'], JSON.parse(req.postData()).model); await r.fulfill({status:200,headers:{'access-control-allow-origin':'*','content-type':'application/json'},body:JSON.stringify({content:[{type:'text',text:'### Verdict\n**Great** session.\n- one\n- two'}]})}); });
 await p.evaluate(()=>{window.__nsa.state.ai.key='sk-ant-test';});
 await p.click('[data-act=ai-run]'); await p.waitForSelector('.ai-out',{timeout:8000});
 console.log('AI out:', await p.textContent('.ai-out'));
 await p.screenshot({path:'shots/ai.png',fullPage:true});
 console.log('errors',errs);
 await b.close();
})();
