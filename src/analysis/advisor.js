/**
 * Mesin saran: aturan deterministik (tanpa AI) yang menilai kondisi simulasi terhadap target
 * profil biota, keselamatan sistem, dan kesetimbangan hidrolik. Fungsi murni → bisa diuji.
 *
 * Setiap temuan: { id, cat, level, title, now, target, advice, refs, ev, action? }
 *   level: 'bad' (kritis) | 'warn' (perhatian) | 'info' (catatan) | 'ok' (baik)
 *   ev: tingkat bukti A/B/C (lihat references.js)
 *   action: { label, set: [[jalur, nilai], ...] } — perubahan parameter sekali klik
 */
import { equilibriumLevel, skimmerActive, rimOf, totalVolume } from '../physics/hydraulics.js';
import { GEO, FSW } from '../physics/constants.js';
import { NOZZLE, dirOf, siphonX } from '../layout.js';
import { PROFILES } from './profiles.js';

export const LEVELS = ['bad', 'warn', 'info', 'ok'];
export const LEVEL_LABEL = { bad: 'Kritis', warn: 'Perhatian', info: 'Catatan', ok: 'Baik' };
export const CATEGORIES = {
  keamanan: 'Keamanan sistem',
  hidrolik: 'Kesetimbangan hidrolik',
  filter: 'Filter',
  arus: 'Arus & pertukaran air',
  air: 'Salinitas',
  uji: 'Hasil uji',
};
/** Waktu CFD minimum sejak arus diulang sebelum statistik arus dianggap mewakili (dtk). */
export const FLOW_WARMUP = 60;

const f1 = (v, d = 1) => (+v).toFixed(d).replace('.', ',');

/**
 * @param {object} ctx
 * @param {object} ctx.app       state aplikasi (S, P, V, NZL, WM, profile)
 * @param {object} ctx.stats     statistik CFD terakhir (app.flowStats)
 * @param {number} ctx.cfdAge    waktu CFD sejak arus terakhir diulang (dtk)
 * @param {object} [ctx.eq]      hasil "Cari titik seimbang"
 * @param {object} [ctx.pulse]   hasil uji pulsa standar
 */
export function analyze({ app, stats = {}, cfdAge = 0, eq = null, pulse = null }) {
  const { S, P, V, NZL } = app;
  const prof = PROFILES[app.profile] || PROFILES.fowlr;
  const q = S.q;
  const out = [];
  const add = (f) => out.push(f);
  const litres = totalVolume(S, P) / 1000 - P.disp;
  const salinity = S.salt / Math.max(1, litres);

  /* ================= keamanan ================= */
  if (S.spill > 50) {
    add({
      id: 'spill', cat: 'keamanan', level: 'bad', title: 'Air tumpah ke lantai',
      now: f1(S.spill / 1000, 2) + ' L', target: '0 L',
      advice: 'Cari penyebabnya: siphon putus tanpa pelampung atas, volume air berlebih, atau kapas meluber. Pasang pelampung atas dan cek "Level bila listrik padam".',
      refs: [], ev: 'B',
    });
  }
  if (P.on && S.HP < 2.3) {
    add({
      id: 'dry', cat: 'keamanan', level: 'bad', title: 'Pompa jalan kering',
      now: 'chamber pompa ' + f1(S.HP) + ' cm', target: '> ' + FSW.LO_OFF + ' cm',
      advice: 'Pompa menghisap udara dan bisa rusak. Pasang pelampung bawah, isi air, atau cek ATO.',
      refs: [], ev: 'B', action: P.fswLo ? null : { label: 'Pasang pelampung bawah', set: [['P.fswLo', true]] },
    });
  }
  if (P.on && S.brk.slice(0, P.n).some(Boolean)) {
    add({
      id: 'brk', cat: 'keamanan', level: S.cutHi ? 'warn' : 'bad', title: 'Siphon putus',
      now: S.cutHi ? 'pompa ditahan pelampung atas' : 'pompa tetap mengisi tank', target: 'siphon penuh air',
      advice: 'Pancing ulang siphon (tombol "Pancing siphon"). Venturi/aqualifter membuang udara di puncak U secara otomatis.',
      refs: ['davies1950'], ev: 'B', action: P.venturi ? null : { label: 'Nyalakan venturi', set: [['P.venturi', true]] },
    });
  }
  if (!P.box) {
    const L = equilibriumLevel(S, P);
    const area = GEO.AT + GEO.A1 + GEO.A2 + GEO.A3 + GEO.AP;
    if (L > 28.5) {
      const excess = ((L - 28.3) * area) / 1000;
      add({
        id: 'outage', cat: 'keamanan', level: L > 29.5 ? 'bad' : 'warn', title: 'Level bila listrik padam terlalu tinggi',
        now: f1(L) + ' cm', target: '≤ 28,3 cm (bibir 30 cm)',
        advice: `Saat semua aliran berhenti, air dari filter dan pipa berkumpul. Kurangi volume air ±${f1(excess, 1)} L (tab Tank → Air), atau pastikan lubang siphon-break aktif.`,
        refs: [], ev: 'B',
      });
    } else if (L < P.zin + 0.3) {
      add({
        id: 'outage', cat: 'keamanan', level: P.venturi ? 'info' : 'warn', title: 'Intake siphon terbuka saat listrik padam',
        now: 'level ' + f1(L) + ' cm, intake ' + f1(P.zin) + ' cm', target: 'level di atas intake',
        advice: P.venturi
          ? 'Siphon akan kemasukan udara; venturi membantu memancing ulang saat listrik nyala. Uji dengan studi "Uji padam listrik 60 detik".'
          : 'Siphon akan putus dan tidak tersambung sendiri. Nyalakan venturi/aqualifter, atau turunkan intake bawah.',
        refs: ['davies1950'], ev: 'B', action: P.venturi ? null : { label: 'Nyalakan venturi', set: [['P.venturi', true]] },
      });
    } else {
      add({ id: 'outage', cat: 'keamanan', level: 'ok', title: 'Level bila listrik padam aman', now: f1(L) + ' cm', target: '≤ 28,3 cm', advice: '', refs: [], ev: 'B' });
    }
  }
  if (!P.fswHi) {
    add({
      id: 'fswHi', cat: 'keamanan', level: 'warn', title: 'Pelampung atas (auto-off) belum dipasang',
      now: 'tidak ada', target: 'pompa mati di ' + f1(FSW.HI_OFF) + ' cm',
      advice: 'Bila siphon putus, pompa terus mengisi tank sampai meluap (lihat studi "Siphon putus").',
      refs: [], ev: 'B', action: { label: 'Pasang pelampung atas', set: [['P.fswHi', true]] },
    });
  }
  if (!P.fswLo) {
    add({
      id: 'fswLo', cat: 'keamanan', level: 'warn', title: 'Pelampung bawah (auto-off) belum dipasang',
      now: 'tidak ada', target: 'pompa mati di ' + FSW.LO_OFF + ' cm',
      advice: 'Melindungi pompa dari jalan kering bila chamber pompa terkuras (penguapan, ATO habis, tumpah).',
      refs: [], ev: 'B', action: { label: 'Pasang pelampung bawah', set: [['P.fswLo', true]] },
    });
  }
  if (!P.hole && !P.box) {
    add({
      id: 'hole', cat: 'keamanan', level: 'warn', title: 'Tanpa lubang siphon-break di pipa return',
      now: 'tidak ada', target: 'lubang di ' + f1(GEO.ZHOLE) + ' cm',
      advice: 'Saat listrik padam, air tank tersedot balik lewat pipa return sampai ujung duckbill keluar dari air.',
      refs: [], ev: 'B', action: { label: 'Aktifkan lubang siphon-break', set: [['P.hole', true]] },
    });
  }
  if (P.ato && S.ato >= GEO.ATOMAX) {
    add({ id: 'atoEmpty', cat: 'keamanan', level: 'warn', title: 'Reservoir ATO habis', now: f1(S.ato / 1000, 2) + ' L terpakai', target: 'isi ulang', advice: 'Isi ulang reservoir air tawar (RO/DI); tanpa ATO, penguapan menaikkan salinitas.', refs: ['millero2008'], ev: 'B' });
  }

  /* ================= kesetimbangan hidrolik ================= */
  if (P.on) {
    if (S.cutHi) {
      add({
        id: 'cutHi', cat: 'hidrolik', level: 'warn', title: 'Pelampung atas memutus pompa',
        now: 'tank ' + f1(S.HT) + ' cm', target: 'level stabil < ' + f1(FSW.HI_ON) + ' cm',
        advice: 'Siphon tidak sanggup membawa debit return pada bukaan valve ini, jadi pompa hidup-mati. Buka ball valve U-pipe atau pakai "Cari titik seimbang".',
        refs: ['moody1944'], ev: 'B',
      });
    } else if (S.HT > FSW.HI_ON + 0.3) {
      add({
        id: 'level', cat: 'hidrolik', level: 'warn', title: 'Level tank dekat pelampung atas',
        now: f1(S.HT, 2) + ' cm', target: '< ' + f1(FSW.HI_ON + 0.3) + ' cm',
        advice: 'Cadangan kecil: sedikit penyumbatan intake membuat pompa mati. Buka sedikit ball valve U-pipe atau jalankan "Cari titik seimbang".',
        refs: ['moody1944'], ev: 'B',
      });
    }
    const air = Math.max(...S.air.slice(0, P.n));
    if (!S.brk.slice(0, P.n).some(Boolean) && air > 0.15) {
      add({
        id: 'gurgle', cat: 'hidrolik', level: 'warn', title: 'Udara menumpuk di puncak U (gluk-gluk)',
        now: Math.round(air * 100) + '% udara', target: '< 15%',
        advice: P.venturi ? 'Kecepatan air di U-pipe terlalu rendah untuk menyapu gelembung; tutup sedikit valve U-pipe agar level naik dan aliran lebih penuh.' : 'Nyalakan venturi/aqualifter untuk membuang udara di puncak U.',
        refs: ['davies1950'], ev: 'B', action: P.venturi ? null : { label: 'Nyalakan venturi', set: [['P.venturi', true]] },
      });
    }
    const rim = rimOf(S, P);
    if (skimmerActive(P, rim)) {
      const head = S.HT - rim;
      const share = q.s > 1 ? q.k / q.s : 0;
      if (S.airIn.slice(0, P.n).some((v) => v > 0)) {
        add({
          id: 'skimAir', cat: 'hidrolik', level: 'warn', title: 'Surface skimmer menghisap udara',
          now: 'air ' + f1(head, 2) + ' cm di atas bibir', target: '≥ 0,3 cm',
          advice: 'Level terlalu rendah terhadap bibir mangkuk. Tutup sedikit ball valve U-pipe (level naik) atau turunkan bibir mangkuk.',
          refs: ['villemonte1947'], ev: 'B',
        });
      } else if (share < 0.2) {
        add({
          id: 'surface', cat: 'hidrolik', level: 'info', title: 'Sedikit air lewat surface skimmer',
          now: Math.round(share * 100) + '% debit siphon', target: '≥ 20% (konsensus praktisi)',
          advice: 'Lapisan permukaan (film protein) kurang tersedot. Kecilkan "Bukaan intake bawah" atau tutup sedikit valve U-pipe supaya level naik di atas bibir.',
          refs: ['villemonte1947'], ev: 'C',
        });
      } else {
        add({ id: 'surface', cat: 'hidrolik', level: 'ok', title: 'Surface skimmer bekerja', now: Math.round(share * 100) + '% debit · ' + f1(head, 2) + ' cm di atas bibir', target: '≥ 20%', advice: '', refs: ['villemonte1947'], ev: 'C' });
      }
    }
    if (P.rv < 0.9) {
      add({
        id: 'throttle', cat: 'hidrolik', level: 'info', title: 'Debit return dicekik ball valve',
        now: 'valve ' + Math.round(P.rv * 100) + '%', target: 'valve terbuka, atur daya pompa',
        advice: 'Mencekik valve membuang energi. Untuk pompa DC, turunkan "Daya pompa" saja: daya listrik turun kira-kira pangkat tiga dari putaran (hukum afinitas).',
        refs: ['moody1944'], ev: 'B',
      });
    }
    const vTank = (GEO.AT * S.HT) / 1000 - P.disp;
    const turn = (Math.max(0, q.r) * 3.6) / Math.max(1, vTank);
    add({
      id: 'turnover', cat: 'hidrolik', level: turn < 3 ? 'warn' : turn > 12 ? 'info' : 'ok', title: 'Sirkulasi lewat filter',
      now: f1(turn) + '×/jam', target: '±3–10×/jam (konsensus praktisi)',
      advice: turn < 3 ? 'Air terlalu jarang lewat filter: naikkan daya pompa atau buka valve return.' : turn > 12 ? 'Sirkulasi tinggi: waktu kontak di skimmer/bio lebih pendek dan suara lebih bising.' : '',
      refs: [], ev: 'C',
    });
  }

  /* ================= filter ================= */
  if (S.H1 > 28.5 || P.clog >= 0.85) {
    add({ id: 'clog', cat: 'filter', level: 'bad', title: 'Kapas hampir meluber', now: 'kotor ' + Math.round(P.clog * 100) + '% · ch1 ' + f1(S.H1) + ' cm', target: 'ch1 < 28 cm', advice: 'Ganti/cuci kapas sekarang; air bisa melimpas melewati kapas tanpa tersaring.', refs: ['chen1993'], ev: 'B', action: { label: 'Kapas baru (0%)', set: [['P.clog', 0]] } });
  } else if (P.clog >= 0.5) {
    add({ id: 'clog', cat: 'filter', level: 'warn', title: 'Kapas mulai mampet', now: Math.round(P.clog * 100) + '% · ch1 ' + f1(S.H1) + ' cm', target: '< 50%', advice: 'Jadwalkan penggantian kapas; kapas kotor menyimpan detritus yang terurai menjadi nutrien.', refs: ['chen1993'], ev: 'B', action: { label: 'Kapas baru (0%)', set: [['P.clog', 0]] } });
  }
  if (V.cfd && cfdAge >= FLOW_WARMUP && stats.fdead !== undefined && stats.fdead > 40) {
    add({ id: 'fdead', cat: 'filter', level: 'info', title: 'Banyak zona mati di filter', now: Math.round(stats.fdead) + '% volume < 1 cm/s', target: '< 40%', advice: 'Detritus cenderung mengendap di sudut chamber; jadwalkan sedot dasar sump.', refs: ['chen1993'], ev: 'C' });
  }

  /* ================= arus & pertukaran air ================= */
  if (!V.cfd) {
    add({ id: 'cfdOff', cat: 'arus', level: 'info', title: 'Analisis arus belum aktif', now: 'simulasi arus mati', target: 'nyalakan', advice: 'Saran arus, zona mati, dan umur air butuh simulasi arus (CFD).', refs: [], ev: 'B', action: { label: 'Nyalakan simulasi arus', set: [['V.cfd', true]] } });
  } else if (cfdAge < FLOW_WARMUP) {
    add({ id: 'warmup', cat: 'arus', level: 'info', title: 'Arus masih berkembang', now: Math.round(cfdAge) + ' / ' + FLOW_WARMUP + ' dtk simulasi', target: '≥ ' + FLOW_WARMUP + ' dtk', advice: 'Saran arus muncul setelah pola arus stabil.', refs: [], ev: 'B' });
  } else {
    const F = prof.flow;
    const wmAction = !V.wm ? { label: 'Nyalakan wavemaker', set: [['V.wm', true]] } : app.WM.q < 2500 ? { label: 'Wavemaker 2.500 L/jam', set: [['WM.q', 2500]] } : null;
    if (F.rock && stats.rockMean !== undefined && stats.rockCells > 0) {
      const lowMean = stats.rockMean < F.rock;
      const lowDead = stats.rockDead > F.rockDeadMax;
      add({
        id: 'rock', cat: 'arus', level: stats.rockMean < F.rock / 2 ? 'bad' : lowMean || lowDead ? 'warn' : 'ok',
        title: 'Arus di sekitar batu (zona karang)',
        now: f1(stats.rockMean) + ' cm/s rata-rata · ' + Math.round(stats.rockDead) + '% < 1 cm/s', target: '≥ ' + F.rock + ' cm/s · zona mati ≤ ' + F.rockDeadMax + '%',
        advice: lowMean || lowDead ? 'Tambah arus ke arah batu: nyalakan/arahkan wavemaker ke batu, naikkan debitnya, atau arahkan duckbill melewati puncak batu. ' + prof.why : prof.why,
        refs: prof.flowRefs, ev: prof.flowEv, action: lowMean || lowDead ? wmAction : null,
      });
    }
    const dead = stats.dead ?? 0;
    add({
      id: 'dead', cat: 'arus', level: dead > F.deadMax + 15 ? 'bad' : dead > F.deadMax ? 'warn' : 'ok',
      title: 'Zona mati tank (arus < 1 cm/s)',
      now: Math.round(dead) + '% volume', target: '≤ ' + F.deadMax + '%',
      advice: dead > F.deadMax ? 'Nyalakan wavemaker atau ubah arahnya ke area yang diam; arus silang dari dua sumber mengurangi sudut mati.' + (prof === PROFILES.fowlr ? ' ' + prof.why : '') : '',
      refs: prof.flowRefs, ev: prof === PROFILES.fowlr ? 'C' : prof.flowEv, action: dead > F.deadMax ? wmAction : null,
    });
    if (!F.rock) {
      add({
        id: 'mean', cat: 'arus', level: stats.mean < F.mean ? 'warn' : 'ok', title: 'Arus rata-rata tank',
        now: f1(stats.mean) + ' cm/s', target: '≥ ' + F.mean + ' cm/s',
        advice: stats.mean < F.mean ? 'Tambah sumber arus (wavemaker) atau debit pompa.' : '', refs: prof.flowRefs, ev: prof.flowEv, action: stats.mean < F.mean ? wmAction : null,
      });
    }
    add({
      id: 'bottom', cat: 'arus', level: stats.bottom < F.bottom ? 'warn' : 'ok', title: 'Arus di dasar (detritus)',
      now: f1(stats.bottom) + ' cm/s', target: '≥ ' + F.bottom + ' cm/s',
      advice: stats.bottom < F.bottom ? 'Kotoran cenderung mengendap di pasir. Arahkan duckbill sedikit ke bawah, atau turunkan posisi wavemaker.' : '',
      refs: ['chen1993'], ev: 'C',
    });
    // pertukaran air: perlu waktu ± satu waktu tinggal agar umur air mewakili
    if (stats.tauN > 0) {
      if (cfdAge < stats.tauN) {
        add({ id: 'ace', cat: 'arus', level: 'info', title: 'Umur air belum stabil', now: f1(cfdAge / 60) + ' / ' + f1(stats.tauN / 60) + ' menit', target: '≥ 1 waktu tinggal τ', advice: 'Efisiensi pertukaran air dinilai setelah ± satu waktu tinggal.', refs: ['sandberg1981'], ev: 'B' });
      } else {
        const ace = stats.ace;
        add({
          id: 'ace', cat: 'arus', level: ace < 0.35 ? 'bad' : ace < 0.42 ? 'warn' : 'ok', title: 'Efisiensi pertukaran air',
          now: Math.round(ace * 100) + '% · air tua ' + Math.round(stats.stagnant) + '%', target: '≈ 50% (campur sempurna) · air tua ≤ 10%',
          advice: ace < 0.42 ? 'Ada jalan pintas: sebagian air baru langsung tersedot intake sementara bagian lain jarang tergantikan. Ubah arah duckbill menjauhi intake siphon dan jalankan "Uji pulsa standar".' : '',
          refs: ['sandberg1981', 'danckwerts1953'], ev: 'B',
        });
      }
    }
  }
  // jalan pintas geometris: duckbill mengarah lurus ke intake siphon
  {
    const d = dirOf(NZL.yaw, NZL.pitch);
    const ix = siphonX(P.n, 0) - NOZZLE[0];
    const iy = (P.box ? 20 : P.zin + 0.8) - NOZZLE[1];
    const iz = 3.5 - NOZZLE[2];
    const L = Math.hypot(ix, iy, iz) || 1;
    const cos = (d[0] * ix + d[1] * iy + d[2] * iz) / L;
    if (cos > Math.cos((25 * Math.PI) / 180)) {
      add({
        id: 'aim', cat: 'arus', level: 'warn', title: 'Duckbill mengarah ke intake siphon',
        now: 'selisih sudut ' + Math.round((Math.acos(Math.min(1, cos)) * 180) / Math.PI) + '°', target: '> 25°',
        advice: 'Air baru dari filter langsung tersedot kembali (jalan pintas). Putar duckbill ke depan atau ke atas.',
        refs: ['danckwerts1953'], ev: 'B', action: { label: 'Duckbill 20° ke depan, 15° ke atas', set: [['NZL.yaw', 20], ['NZL.pitch', 15]] },
      });
    }
  }

  /* ================= salinitas ================= */
  {
    const [lo, hi] = prof.sal.ok;
    const [hlo, hhi] = prof.sal.hard;
    const coral = prof !== PROFILES.fowlr;
    const level = salinity < hlo || salinity > hhi ? 'bad' : salinity < lo || salinity > hi ? 'warn' : 'ok';
    add({
      id: 'sal', cat: 'air', level, title: 'Salinitas', now: f1(salinity, 2) + ' ppt', target: lo + '–' + hi + ' ppt',
      advice:
        level === 'ok'
          ? ''
          : salinity < lo
            ? 'Terlalu tawar: tambahkan air laut/garam bertahap.' + (coral ? ' Penurunan salinitas memicu stres dan pemutihan karang (Kerswell & Jones 2003; Berkelmans 2012).' : '')
            : 'Terlalu asin (penguapan tanpa ATO): tambahkan air tawar RO/DI bertahap.',
      refs: coral ? ['millero2008', 'kerswell2003', 'berkelmans2012'] : ['millero2008'], ev: coral && salinity < lo ? 'A' : prof.sal.ev,
    });
    if (V.cfd && cfdAge >= FLOW_WARMUP && coral && stats.saltTmin !== undefined && stats.saltTmin < lo - 0.5) {
      add({
        id: 'salLocal', cat: 'air', level: 'warn', title: 'Kantong air tawar di tank',
        now: 'min ' + f1(stats.saltTmin, 2) + ' ppt', target: '≥ ' + f1(lo - 0.5) + ' ppt',
        advice: 'Air tawar ATO belum tercampur sebelum masuk tank. Teteskan ATO di dekat terjunan weir atau perlambat debit ATO.',
        refs: ['kerswell2003'], ev: 'A',
      });
    }
    if (!P.ato) {
      add({ id: 'atoOff', cat: 'air', level: 'info', title: 'ATO mati', now: 'tidak aktif', target: 'aktif', advice: 'Penguapan (tidak dimodelkan sebagai aliran) akan menaikkan salinitas; isi ulang air tawar secara manual setiap hari.', refs: ['millero2008'], ev: 'B', action: { label: 'Aktifkan ATO', set: [['P.ato', true]] } });
    }
  }

  /* ================= hasil uji ================= */
  if (eq?.best) {
    const diff = Math.abs(P.sv - eq.best.sv) > 0.075;
    add({
      id: 'eq', cat: 'uji', level: diff ? 'info' : 'ok', title: 'Titik seimbang valve U-pipe',
      now: 'valve ' + Math.round(P.sv * 100) + '%', target: Math.round(eq.best.sv * 100) + '% (hasil pencarian)',
      advice: diff ? eq.note : 'Setelan sekarang sudah di titik seimbang hasil pencarian.',
      refs: ['moody1944', 'villemonte1947'], ev: 'B', action: diff ? { label: 'Terapkan valve ' + Math.round(eq.best.sv * 100) + '%', set: [['P.sv', eq.best.sv]] } : null,
    });
  }
  if (pulse?.result) {
    const r = pulse.result;
    add({
      id: 'pulse', cat: 'uji', level: r.level, title: 'Uji pulsa standar',
      now: r.summary, target: 't95 ≤ τ · tanpa jalan pintas',
      advice: r.advice, refs: ['danckwerts1953', 'sandberg1981'], ev: 'B',
    });
  }

  // "Kritis" hanya untuk bukti A/B; aturan konsensus praktisi (C) paling tinggi "perlu perhatian"
  for (const f of out) if (f.ev === 'C' && f.level === 'bad') f.level = 'warn';
  out.sort((a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level));
  const count = { bad: 0, warn: 0, info: 0, ok: 0 };
  for (const f of out) count[f.level]++;
  return { findings: out, count, profile: prof, salinity };
}

/** Terapkan aksi saran: daftar [jalur 'P.sv', nilai]. */
export function applyAction(app, action) {
  for (const [path, value] of action.set) {
    const [root, key] = path.split('.');
    app[root][key] = value;
  }
}
