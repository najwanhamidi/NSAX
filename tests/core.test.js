require('../src/core.js');
const N = globalThis.NSA;
for (const t5 of [900,1200,1500,1800]) {
  const v = N.vdotFromRace(5000,t5);
  for (const m of ['guide','copeland','blend']) {
    const fit = N.fitnessFromVdot(v,m);
    console.log(N.fmtTime(t5),'vdot',v.toFixed(1),m,[180,360,600,60,1200].map(d=>N.fmtPace(N.repPace(fit,d))).join(' '),'easy',N.fmtPace(fit.easy.fast),'-',N.fmtPace(fit.easy.slow),'thr',N.fmtPace(fit.thresholdPace));
  }
}
// HM-based
const v=N.vdotFromRace(21097.5,95*60+30); console.log('HM 1:35:30 vdot',v.toFixed(1),'5k',N.fmtTime(N.raceTimeForVdot(v,5000)));
