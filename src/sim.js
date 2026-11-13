/**
 * Penggerak simulasi hidrolik dengan langkah waktu tetap (akumulator),
 * sehingga hasil tidak bergantung pada frame rate perangkat.
 */
import { app } from './state.js';
import { step } from './physics/hydraulics.js';
import { PHYS_DT } from './physics/constants.js';

/** Cukup untuk 20× pada 4 fps (0,25 dtk × 20 = 5 dtk simulasi = 250 langkah); satu langkah hanya beberapa mikrodetik. */
const MAX_STEPS_PER_FRAME = 300;
let acc = 0;
let histAcc = 0;

/**
 * Majukan simulasi sebesar `real` detik nyata × kecepatan simulasi.
 * @returns {number} waktu simulasi yang dimajukan (detik)
 */
export function advance(real, onPowerRestored) {
  if (app.paused) return 0;
  const simdt = real * app.SPD;
  acc += simdt;
  let n = 0;
  while (acc >= PHYS_DT && n < MAX_STEPS_PER_FRAME) {
    step(app.S, app.P, PHYS_DT);
    acc -= PHYS_DT;
    n++;
  }
  if (n === MAX_STEPS_PER_FRAME) acc = 0; // perangkat terlalu lambat: buang sisa, jangan menumpuk
  if (app.tOn && app.S.t >= app.tOn) {
    app.tOn = 0;
    app.P.on = true;
    onPowerRestored?.();
  }
  histAcc += simdt;
  if (histAcc >= 0.5) {
    histAcc = 0;
    const S = app.S;
    app.hist.push({ t: S.t, HT: S.HT, HB: S.HB, H1: S.H1, H2: S.H2, H3: S.H3, HP: S.HP, qs: S.q.s * 3.6, qr: S.q.r * 3.6 });
    if (app.hist.length > 300) app.hist.shift();
  }
  return simdt;
}
