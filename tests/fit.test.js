require('../src/core.js'); require('../src/parsers.js'); require('../src/analyze.js');
const fs=require('fs'); const N=globalThis.NSA;
const model=N.buildModel({lthr:178,hrMax:null,paceModel:'blend',races:[{uid:'a',id:'5k',timeSec:1200,date:'2026-10-01'}]});
console.log('VDOT',model.fit.vdot.toFixed(1),'easyCap',model.hr.easyCap);
for (const f of process.argv.slice(2)) {
  const buf=fs.readFileSync(f); const ab=buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength);
  const raw=N.parseFit(ab);
  const A=N.analyzeWorkout(raw,model,{unit:'km'});
  console.log('\n==',f.split('/').pop(),raw.records.length,'recs',raw.laps.length,'laps | mode',A.mode,'via',A.method,'| score',A.scores.total,A.verdict.label);
  if(A.reps){console.log(A.set.label,'WU',Math.round(A.warmup.dur),'CD',Math.round(A.cooldown.dur));
   console.log(A.reps.map(r=>`${r.idx}:${Math.round(r.dur)}s ${N.fmtPace(r.pace)} (t ${N.fmtPace(r.target)}) ${(r.dev*100).toFixed(1)}% endHR ${Math.round(r.endHr)}`).join('\n'));
   console.log('rests',A.rests.map(r=>Math.round(r.dur)).join(','));}
  console.log(A.scores.parts.map(p=>p.label+' '+p.score+' ('+p.note+')').join('\n'));
  console.log(A.findings.map(x=>'['+x.type+'] '+x.text).join('\n'));
}
