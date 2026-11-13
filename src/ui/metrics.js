/** Kartu metrik dan pesan status di pojok tampilan 3D. */
import { app, waterLitres, salinity } from '../state.js';
import { skimmerActive, equilibriumLevel } from '../physics/hydraulics.js';
import { GEO } from '../physics/constants.js';
import { fmt, $, el } from '../util/format.js';

/** [id, label, utama?] — metrik utama selalu tampil di atas tab, sisanya di tab Metrik. */
const MET = [
  ['mT', 'Level tank', true],
  ['mIn', 'Lewat surface skimmer'],
  ['mCup', 'Level dalam skimmer'],
  ['m12', 'Ch 1 kapas / Ch 2'],
  ['m3P', 'Ch 3 / Ch pompa'],
  ['mQs', 'Debit siphon', true],
  ['mQr', 'Debit return', true],
  ['mPump', 'Status pompa', true],
  ['mV', 'Kecepatan di U-pipe'],
  ['mHp', 'Head pompa / statis'],
  ['mVol', 'Volume air sekarang'],
  ['mEq', 'Level bila listrik padam'],
  ['mAir', 'Udara di puncak U'],
  ['mEnd', 'Ujung buang'],
  ['mTo', 'Sirkulasi tank'],
  ['mRes', 'Waktu kontak skimmer / bio'],
  ['mDead', 'Zona mati tank (<1 cm/s)', true],
  ['mDeadF', 'Zona mati filter (<1 cm/s)', true],
  ['mAge', 'Umur air rata-rata tank'],
  ['mAce', 'Efisiensi pertukaran air'],
  ['mStag', 'Air tua (umur > 2× waktu tinggal)'],
  ['mDyeT', 'Air baru (pewarna) tank / filter'],
  ['mSalLoc', 'Salinitas lokal tank (min–maks)'],
  ['mSalLocF', 'Salinitas lokal filter (min–maks)'],
  ['mFlow', 'Arus rata-rata / dasar'],
  ['mSal', 'Salinitas'],
  ['mAto', 'Air tawar dari ATO'],
  ['mSp', 'Air tumpah'],
];

const C_OK = '12,163,12';
const C_WARN = '214,150,0';
const C_BAD = '208,59,59';

const KEY_ORDER = ['mT', 'mPump', 'mQs', 'mQr', 'mDead', 'mDeadF'];

export function buildMetrics() {
  const root = $('metrics');
  const keyRoot = $('metricsKey');
  const nodes = {};
  const cards = {};
  for (const [id, label, key] of MET) {
    const b = el('b', { id, textContent: '-' });
    cards[id] = el('div', { className: 'm' + (key ? ' key' : '') }, [el('span', { textContent: label }), b]);
    nodes[id] = b;
    if (!key || !keyRoot) root.append(cards[id]);
  }
  if (keyRoot) for (const id of KEY_ORDER) keyRoot.append(cards[id]);
  // tulis ke DOM hanya bila teks berubah
  const cache = {};
  const set = (id, v) => {
    if (cache[id] !== v) {
      cache[id] = v;
      nodes[id].textContent = v;
    }
  };
  const status = $('status');
  let lastStatus = '';

  function update() {
    const { S, P, V, flowStats } = app;
    const q = S.q;
    set('mT', fmt(S.HT) + ' cm' + (P.box ? ' · box ' + fmt(S.HB) : ''));
    {
      const on = skimmerActive(P, S.rim[0]);
      const tot = Math.max(1, q.s);
      set('mIn', on ? Math.round(q.k * 3.6) + ' L/jam · ' + Math.round((100 * Math.max(0, q.k)) / tot) + '%' : '-');
      set('mCup', on ? fmt(S.Hc[0]) + ' cm · bibir ' + fmt(S.rim[0]) : '-');
      const Qm = Math.max(1, q.q23);
      set('mRes', q.q23 > 2 ? Math.round((GEO.A2 * S.H2) / Qm) + ' / ' + Math.round((150 * S.H3) / Qm) + ' dtk' : '-');
    }
    set('m12', fmt(S.H1) + ' / ' + fmt(S.H2) + ' cm');
    set('m3P', fmt(S.H3) + ' / ' + fmt(S.HP) + ' cm');
    set('mQs', Math.round(q.s * 3.6) + ' L/jam');
    set('mQr', (q.r < -0.3 ? 'balik ' : '') + Math.round(Math.abs(q.r) * 3.6) + ' L/jam');
    let vmax = 0;
    for (let i = 0; i < P.n; i++) vmax = Math.max(vmax, Math.abs(S.vs[i]));
    set('mV', fmt(vmax / 100, 2) + ' m/s');
    {
      // pompa jalan atau dimatikan oleh apa
      let ps = 'jalan';
      let bad = false;
      if (!P.on) ps = 'mati · listrik';
      else if (S.cutHi) ps = 'mati · pelampung atas';
      else if (S.cutLo) ps = 'mati · pelampung bawah';
      else if (S.HP < 2.3) {
        ps = 'jalan kering!';
        bad = true;
      }
      set('mPump', ps);
      nodes.mPump.style.color = bad ? 'var(--bad)' : ps === 'jalan' ? '' : 'rgb(' + C_WARN + ')';
    }
    set('mHp', fmt(q.hp, 0) + ' / ' + fmt(q.hs, 0) + ' cm');
    set('mVol', fmt(waterLitres()) + ' L');
    {
      const eq = nodes.mEq;
      if (P.box) {
        set('mEq', 'tank ±26,3 cm');
        eq.style.color = '';
      } else {
        const L = equilibriumLevel(S, P);
        const bad = L < P.zin + 0.3 || L > 29;
        set('mEq', '±' + fmt(L) + ' cm' + (L < P.zin + 0.3 ? ' · intake terbuka' : ''));
        eq.style.color = bad ? 'var(--bad)' : '';
      }
    }
    const a = [];
    for (let i = 0; i < P.n; i++) a.push(S.brk[i] ? 'putus' : Math.round(S.air[i] * 100) + '%');
    set('mAir', a.join(' · '));
    set('mEnd', S.H1 > P.zd ? 'terendam ' + fmt(S.H1 - P.zd) + ' cm' : 'gantung ' + fmt(P.zd - S.H1) + ' cm');
    set('mTo', fmt((Math.max(0, q.r) * 3.6) / Math.max(1, (GEO.AT * S.HT) / 1000 - P.disp), 1) + '× /jam');
    set('mSal', fmt(salinity(), 1) + ' ppt');
    if (V.cfd) {
      set('mDead', fmt(flowStats.dead, 0) + '% · lemah ' + fmt(flowStats.weak, 0) + '%');
      set('mDeadF', flowStats.fdead !== undefined ? fmt(flowStats.fdead, 0) + '% · rata ' + fmt(flowStats.fmean, 1) + ' cm/s' : '-');
      set('mFlow', fmt(flowStats.mean, 1) + ' / ' + fmt(flowStats.bottom, 1) + ' cm/s');
      // transport skalar: umur air, pertukaran, pewarna, salinitas lokal
      const fs = flowStats;
      if (fs.tauN > 0) {
        set('mAge', fmt(fs.ageMean / 60, 1) + ' mnt · τ ' + fmt(fs.tauN / 60, 1) + ' mnt');
        set('mAce', fmt(fs.ace * 100, 0) + '% (50% = campur sempurna)');
        set('mStag', fmt(fs.stagnant, 0) + '% volume tank');
      } else {
        set('mAge', fs.ageMean !== undefined ? fmt(fs.ageMean / 60, 1) + ' mnt · aliran berhenti' : '-');
        set('mAce', '-');
        set('mStag', '-');
      }
      set('mDyeT', fs.dyeT !== undefined ? fmt(fs.dyeT * 100, 0) + '% / ' + fmt(fs.dyeF * 100, 0) + '%' : '-');
      set('mSalLoc', fs.saltTmin !== undefined ? fmt(fs.saltTmin, 2) + '–' + fmt(fs.saltTmax, 2) + ' ppt' : '-');
      set('mSalLocF', fs.saltFmin !== undefined ? fmt(fs.saltFmin, 2) + '–' + fmt(fs.saltFmax, 2) + ' ppt' : '-');
    } else {
      for (const id of ['mDead', 'mDeadF', 'mFlow', 'mAge', 'mAce', 'mStag', 'mDyeT', 'mSalLoc', 'mSalLocF']) set(id, '-');
    }
    set('mAto', fmt(S.ato / 1000, 2) + ' L');
    set('mSp', fmt(S.spill / 1000, 2) + ' L');

    /* status: urutan prioritas dari yang paling berbahaya */
    let nb = 0;
    let gl = false;
    for (let i = 0; i < P.n; i++) {
      if (S.brk[i]) nb++;
      else if (S.air[i] > 0.15) gl = true;
    }
    let msg = 'Normal';
    let col = C_OK;
    if (S.spr > 1) {
      msg = 'MELUAP: air tumpah ke lantai';
      col = C_BAD;
    } else if (nb === P.n && P.on) {
      const held = S.cutHi ? ' · pelampung atas menahan pompa' : S.cutLo ? ' · pelampung bawah menahan pompa' : ' · tank akan meluap';
      msg = 'Siphon putus' + held;
      col = S.cutHi || S.cutLo ? C_WARN : C_BAD;
    } else if (S.cutHi) {
      msg = 'Pelampung atas memutus pompa';
      col = C_WARN;
    } else if (S.cutLo) {
      msg = 'Pelampung bawah memutus pompa';
      col = C_WARN;
    } else if (P.on && S.HP < 2.3) {
      msg = 'Chamber pompa kering';
      col = C_BAD;
    } else if (nb > 0) {
      msg = nb + ' pipa siphon putus';
      col = C_WARN;
    } else if (S.airIn[0] > 0 || S.airIn[1] > 0) {
      msg = 'Surface skimmer menghisap udara';
      col = C_WARN;
    } else if (gl) {
      msg = 'Siphon menghisap udara (gluk-gluk)';
      col = C_WARN;
    } else if (!P.on) {
      msg = app.tOn ? 'Listrik padam, nyala lagi dalam ' + Math.max(0, Math.round(app.tOn - S.t)) + ' dtk' : 'Listrik mati';
      col = C_WARN;
    } else if (S.HT > 29) {
      msg = 'Tank hampir meluap';
      col = C_BAD;
    } else if (P.ato && S.ato >= GEO.ATOMAX) {
      msg = 'Reservoir ATO habis';
      col = C_WARN;
    }
    const key = msg + col;
    if (key !== lastStatus) {
      lastStatus = key;
      status.textContent = msg;
      status.style.background = `rgba(${col},0.22)`;
      status.style.color = `rgb(${col})`;
    }
  }
  return { update };
}

