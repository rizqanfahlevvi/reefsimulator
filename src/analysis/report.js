/**
 * Laporan analisis (Markdown + lampiran JSON) untuk dianalisis lebih lanjut di Claude Project,
 * dan template instruksi Project. Fungsi murni: semua data masuk lewat argumen.
 */
import { equilibriumLevel, skimmerActive, rimOf, totalVolume } from '../physics/hydraulics.js';
import { GEO, FSW } from '../physics/constants.js';
import { REFERENCES, REF_INDEX, EVIDENCE, refLink } from './references.js';
import { CATEGORIES, LEVEL_LABEL } from './advisor.js';
import { PROFILES } from './profiles.js';

const n = (v, d = 1) => (Number.isFinite(+v) ? (+v).toFixed(d).replace('.', ',') : '-');
const pct = (v, d = 0) => n(v * 100, d) + '%';
const yes = (b) => (b ? 'ya' : 'tidak');
const SKIM = ['tanpa surface skimmer', 'mangkuk bercelah tinggi tetap', 'kepala mengapung'];
const ICON = { bad: '✗', warn: '!', info: 'i', ok: '✓' };
const table = (head, rows) => ['| ' + head.join(' | ') + ' |', '|' + head.map(() => '---').join('|') + '|', ...rows.map((r) => '| ' + r.join(' | ') + ' |')].join('\n');
const refTxt = (ids) => (ids?.length ? ' [' + ids.map((id) => REF_INDEX[id]).filter(Boolean).join(', ') + ']' : '');

/**
 * @param {object} c
 * @param {object} c.app
 * @param {object} c.stats       app.flowStats
 * @param {object} c.cfd         {on, mode, msPerStep, ratio, cfdTime, cfdAge}
 * @param {object} c.analysis    hasil analyze()
 * @param {object} [c.eq]        hasil findBalance()
 * @param {object} [c.pulse]     hasil evaluatePulse()
 * @param {object} c.energy      hasil energyStats()
 * @param {string} c.version
 * @param {Date}   c.date
 */
export function buildReport(c) {
  const { app, stats: st = {}, cfd, analysis, eq, pulse, energy } = c;
  const { S, P, V, NZL, WM } = app;
  const q = S.q;
  const prof = PROFILES[app.profile] || PROFILES.fowlr;
  const litres = totalVolume(S, P) / 1000 - P.disp;
  const sal = S.salt / Math.max(1, litres);
  const rim = rimOf(S, P);
  const skOn = skimmerActive(P, rim);
  const vTank = (GEO.AT * S.HT) / 1000 - P.disp;
  const turn = (Math.max(0, q.r) * 3.6) / Math.max(1, vTank);
  const eqL = P.box ? null : equilibriumLevel(S, P);
  const Qm = Math.max(1, q.q23);
  const flowValid = cfd.on && cfd.cfdAge >= 60;
  const date = c.date || new Date();
  const L = [];
  const h = (t) => L.push('', t, '');

  L.push('# Laporan analisis simulasi reef tank');
  L.push('');
  L.push(`- Dibuat: ${date.toLocaleString('id-ID')} · versi aplikasi \`${c.version}\``);
  L.push(`- Profil biota: **${prof.label}**`);
  L.push('- Sumber: Simulasi 3D Reef Tank + Back Filter (model hidrolik + CFD 3D). Angka adalah keluaran model, bukan pengukuran.');
  L.push('- Cara pakai: unggah file ini ke Claude Project (bersama "Instruksi Project"), lalu minta analisis. Data mentah ada di lampiran JSON.');

  /* 1. ringkasan */
  h('## 1. Ringkasan');
  const k = analysis.count;
  L.push(`Status saran: **${k.bad} kritis · ${k.warn} perlu perhatian · ${k.info} catatan · ${k.ok} baik**.`);
  const top = analysis.findings.filter((f) => f.level === 'bad' || f.level === 'warn');
  if (top.length) {
    L.push('');
    for (const f of top) L.push(`- ${ICON[f.level]} **${f.title}** — sekarang ${f.now}; target ${f.target}. ${f.advice}${refTxt(f.refs)}`);
  } else L.push('', 'Tidak ada temuan kritis atau yang perlu perhatian.');

  /* 2. konfigurasi */
  h('## 2. Konfigurasi sistem');
  L.push(
    table(
      ['Parameter', 'Nilai'],
      [
        ['Tank / filter (P×L×T)', '50×25×30 cm / 50×11×30 cm, dasar sama; filter: kapas → skimmer → bio → pompa'],
        ['Volume air bersih', n(litres, 1) + ' L (batu & pasir ' + n(P.disp, 1) + ' L)'],
        ['Pompa return', `Qmax ${P.qmax} L/jam · Hmax ${n(P.hmax, 1)} m · daya ${pct(P.spd)} · ball valve return ${pct(P.rv)}`],
        ['U-pipe siphon', `${P.n} pipa · Ø dalam ${n(P.D * 10, 0)} mm · ball valve ${pct(P.sv)} · ujung buang ${n(P.zd)} cm · venturi ${yes(P.venturi)}`],
        ['Intake', P.box ? 'overflow box (sisir 26,5 cm)' : `bawah ${n(P.zin)} cm (bukaan ${pct(P.kb)}) + ${SKIM[P.sk]}${P.sk === 1 ? ' (bibir ' + n(P.zrim) + ' cm)' : ''}`],
        ['Pengaman', `pelampung atas ${yes(P.fswHi)} (${n(FSW.HI_OFF)} cm) · pelampung bawah ${yes(P.fswLo)} (${FSW.LO_OFF} cm) · lubang siphon-break ${yes(P.hole)} · ATO ${yes(P.ato)}`],
        ['Kapas', 'kotor ' + pct(P.clog)],
        ['Duckbill', `mendatar ${NZL.yaw}° (0 = ke kiri, + ke depan) · naik/turun ${NZL.pitch}°`],
        ['Wavemaker', V.wm ? `nyala · ${WM.q} L/jam · ${WM.yaw}° / ${WM.pitch}° · tinggi ${WM.y} cm (kaca kanan)` : 'mati'],
        ['Batu / pasir di model arus', `${yes(V.rock)} / ${yes(V.sand)}`],
      ],
    ),
  );

  /* 3. hidrolik */
  h('## 3. Hidrolik (kondisi saat laporan dibuat)');
  let vmax = 0;
  for (let i = 0; i < P.n; i++) vmax = Math.max(vmax, Math.abs(S.vs[i]));
  L.push(
    table(
      ['Besaran', 'Nilai'],
      [
        ['Waktu simulasi', n(S.t, 0) + ' dtk · listrik ' + (P.on ? 'nyala' : 'mati')],
        ['Level tank', n(S.HT, 2) + ' cm' + (P.box ? ' · box ' + n(S.HB, 2) + ' cm' : '')],
        ['Level ch1 kapas / ch2 skimmer / ch3 bio / ch pompa', `${n(S.H1)} / ${n(S.H2)} / ${n(S.H3)} / ${n(S.HP)} cm`],
        ['Debit siphon / return', `${Math.round(q.s * 3.6)} / ${Math.round(q.r * 3.6)} L/jam`],
        ['Lewat surface skimmer', skOn ? `${Math.round(q.k * 3.6)} L/jam (${pct(q.s > 1 ? q.k / q.s : 0)}) · air ${n(S.HT - rim, 2)} cm di atas bibir` : '-'],
        ['Head pompa / head statis', `${n(q.hp, 0)} / ${n(q.hs, 0)} cm`],
        ['Kecepatan di U-pipe', n(vmax / 100, 2) + ' m/s'],
        ['Udara di puncak U', S.brk.slice(0, P.n).map((b, i) => (b ? 'putus' : pct(S.air[i]))).join(' · ')],
        ['Status pompa', !P.on ? 'mati (listrik)' : S.cutHi ? 'mati (pelampung atas)' : S.cutLo ? 'mati (pelampung bawah)' : 'jalan'],
        ['Level bila listrik padam', eqL === null ? 'tank ±26,3 cm (overflow box)' : n(eqL, 1) + ' cm (bibir 30 cm)'],
        ['Sirkulasi tank lewat filter', n(turn, 1) + '×/jam'],
        ['Waktu kontak chamber skimmer / bio', q.q23 > 2 ? `${Math.round((GEO.A2 * S.H2) / Qm)} / ${Math.round((150 * S.H3) / Qm)} dtk` : '-'],
        ['Air tawar dari ATO / air tumpah', `${n(S.ato / 1000, 2)} L / ${n(S.spill / 1000, 2)} L`],
      ],
    ),
  );

  /* 4. arus */
  h('## 4. Arus (CFD 3D)');
  if (!cfd.on) L.push('Simulasi arus mati saat laporan dibuat — bagian ini tidak tersedia.');
  else {
    if (!flowValid) L.push(`> Catatan: arus baru berjalan ${n(cfd.cfdAge, 0)} dtk simulasi sejak terakhir diulang; statistik belum mewakili (butuh ≥ 60 dtk).`, '');
    L.push(
      table(
        ['Besaran (laju rata-rata 8 dtk)', 'Nilai', `Target profil ${prof.label}`],
        [
          ['Laju rata-rata tank', n(st.mean, 2) + ' cm/s', prof.flow.rock ? '-' : '≥ ' + prof.flow.mean + ' cm/s'],
          ['Laju di dasar', n(st.bottom, 2) + ' cm/s', '≥ ' + prof.flow.bottom + ' cm/s'],
          ['Zona mati tank (< 1 cm/s)', n(st.dead, 0) + '% volume', '≤ ' + prof.flow.deadMax + '%'],
          ['Zona lemah tank (1–3 cm/s)', n(st.weak, 0) + '% volume', '-'],
          ['Sekitar batu: laju rata-rata', st.rockCells ? n(st.rockMean, 2) + ' cm/s (' + st.rockCells + ' sel)' : '-', prof.flow.rock ? '≥ ' + prof.flow.rock + ' cm/s' : '-'],
          ['Sekitar batu: zona mati', st.rockCells ? n(st.rockDead, 0) + '%' : '-', prof.flow.rockDeadMax ? '≤ ' + prof.flow.rockDeadMax + '%' : '-'],
          ['Filter: zona mati / laju rata-rata', `${n(st.fdead, 0)}% / ${n(st.fmean, 2)} cm/s`, '-'],
        ],
      ),
    );
    L.push('', `Mesin CFD: ${cfd.mode} · ${n(cfd.msPerStep, 0)} ms/langkah · CFD mengikuti ${pct(cfd.ratio)} waktu simulasi · waktu CFD ${n(cfd.cfdTime, 0)} dtk.`);
  }

  /* 5. pertukaran air & salinitas */
  h('## 5. Pertukaran air & salinitas');
  L.push(
    table(
      ['Besaran', 'Nilai', 'Keterangan'],
      [
        ['Waktu tinggal nominal τ = V/Q', st.tauN ? n(st.tauN / 60, 1) + ' menit' : '-', 'volume tank ÷ debit return'],
        ['Umur air rata-rata tank', st.ageMean !== undefined ? n(st.ageMean / 60, 1) + ' menit' : '-', 'sejak keluar duckbill [' + REF_INDEX.sandberg1981 + ']'],
        ['Efisiensi pertukaran air', st.ace ? pct(st.ace) : '-', '50% = campur sempurna; < 50% = jalan pintas/ruang mati'],
        ['Air tua (umur > 2τ)', st.stagnant !== undefined ? n(st.stagnant, 0) + '% volume' : '-', ''],
        ['Pewarna "air baru" tank / filter', st.dyeT !== undefined ? `${pct(st.dyeT, 1)} / ${pct(st.dyeF, 1)}` : '-', 'kadar rata-rata saat ini'],
        ['Salinitas rata-rata', n(sal, 2) + ' ppt', `target profil ${prof.sal.ok[0]}–${prof.sal.ok[1]} ppt [${REF_INDEX.millero2008}]`],
        ['Salinitas lokal tank (min–maks)', st.saltTmin !== undefined ? `${n(st.saltTmin, 2)}–${n(st.saltTmax, 2)} ppt` : '-', 'dari transport + gaya apung air tawar ATO'],
        ['Salinitas lokal filter (min–maks)', st.saltFmin !== undefined ? `${n(st.saltFmin, 2)}–${n(st.saltFmax, 2)} ppt` : '-', 'minimum di dekat tetesan ATO'],
      ],
    ),
  );

  /* 6. uji pulsa */
  h('## 6. Uji pulsa standar (tracer)');
  if (!pulse) L.push('Belum dijalankan. (Tab Analisis → Uji pulsa standar.)');
  else {
    L.push(`Pulsa pewarna ${'20'} dtk dari duckbill setelah arus berkembang ≥ 60 dtk; metode distribusi waktu tinggal [${REF_INDEX.danckwerts1953}].`, '');
    L.push(
      table(
        ['Metrik', 'Nilai'],
        [
          ['Waktu homogen 95% di tank (t95)', pulse.t95 === null ? 'belum tercapai' : n(pulse.t95 / 60, 1) + ' menit (' + n(pulse.t95 / Math.max(1, pulse.tau), 2) + '× τ)'],
          ['Waktu tinggal nominal τ', n(pulse.tau / 60, 1) + ' menit'],
          ['Pewarna tiba di intake (10% puncak)', Math.round(pulse.tArrive) + ' dtk'],
          ['Puncak di intake', Math.round(pulse.tPeak) + ' dtk · ' + n(pulse.peakRatio, 2) + '× kadar campur sempurna'],
          ['Volume air bertanda', n(pulse.massL, 2) + ' L → kadar akhir ' + pct(pulse.cInf, 1)],
          ['Penilaian', pulse.summary + ' — ' + pulse.advice],
        ],
      ),
    );
    L.push('', 'Kurva (tiap ±5 dtk):', '');
    L.push(table(['t (dtk)', 'tank %', 'filter %', 'CoV tank', 'intake %'], pulse.samples.map((p) => [p.t, n(p.tank, 2), n(p.filter, 2), n(p.cov, 3), n(p.intake, 2)])));
  }

  /* 7. titik seimbang */
  h('## 7. Titik seimbang valve U-pipe');
  if (!eq) L.push('Belum dijalankan. (Tab Analisis → Cari titik seimbang.)');
  else {
    L.push(eq.note, '');
    L.push(
      table(
        ['Valve U-pipe', 'Level tunak', 'Siphon L/jam', 'Lewat skimmer', 'Status', 'Debit +20%'],
        eq.rows.map((r) => [pct(r.sv), n(r.HT, 2) + ' cm', Math.round(r.qs), pct(r.share), r.ok ? 'stabil' : r.why.join(', '), r.robust === undefined ? '-' : r.robust ? 'stabil (' + n(r.stressHT, 2) + ' cm)' : 'tidak stabil']),
      ),
    );
  }

  /* 8. saran lengkap */
  h('## 8. Saran lengkap (mesin aturan aplikasi)');
  L.push(`Tingkat bukti: A = ${EVIDENCE.A}; B = ${EVIDENCE.B}; C = ${EVIDENCE.C}.`);
  for (const [cat, title] of Object.entries(CATEGORIES)) {
    const fs = analysis.findings.filter((f) => f.cat === cat);
    if (!fs.length) continue;
    L.push('', `### ${title}`, '');
    for (const f of fs) {
      L.push(`- ${ICON[f.level]} **${LEVEL_LABEL[f.level]} — ${f.title}**: sekarang ${f.now}; target ${f.target}. ${f.advice} _(bukti ${f.ev})_${refTxt(f.refs)}`.replace(/\s+_/, ' _'));
    }
  }
  L.push('', `Dasar profil "${prof.label}": ${prof.why}`);

  /* 9. listrik */
  h('## 9. Listrik');
  L.push(`Daya rata-rata ${n(energy.avgW, 1)} W · ${n(energy.kwhMonth, 1)} kWh/bulan · Rp ${Math.round(energy.costMonth).toLocaleString('id-ID')}/bulan (tarif Rp ${n(energy.tarif, 2)}/kWh).`, '');
  L.push(table(['Alat', 'Watt efektif', 'Jam/hari', 'kWh/bulan'], energy.rows.map((r) => [r.n, r.off ? 'mati' : n(r.w, 1), n(r.h, 1), r.off ? '-' : n(r.kwhMonth, 2)])));

  /* 10. batasan */
  h('## 10. Asumsi & batasan model');
  for (const t of [
    'Hidrolik: persamaan momentum kolom air + rugi Darcy–Weisbach [' + REF_INDEX.moody1944 + '], weir dengan koreksi tenggelam [' + REF_INDEX.villemonte1947 + '], kantong udara U-pipe [' + REF_INDEX.davies1950 + ']. Kurva pompa parabolik.',
    'CFD: Navier–Stokes tak-termampatkan 3D, kisi tank 1,53 cm dan filter 1 cm, viskositas eddy, permukaan tutup kaku. Lapisan batas di permukaan karang tidak teresolusi; laju "sekitar batu" adalah laju di sel air yang menempel di batu.',
    'Transport skalar (umur air, pewarna, salinitas) konservatif; salinitas rata-rata dikunci ke neraca garam hidrolik. Isotermal (tanpa suhu); penguapan tidak dimodelkan sebagai aliran.',
    'Ambang target per profil adalah pilihan konservatif aplikasi yang arahnya mengikuti pustaka; bukan batas fisiologis pasti untuk spesies tertentu.',
    'Angka sebaiknya dikalibrasi dengan uji air tawar dan pengukuran nyata (debit, level, arus dengan pelampung/pewarna).',
  ])
    L.push('- ' + t);

  /* 11. pustaka */
  h('## 11. Pustaka');
  REFERENCES.forEach((r, i) => L.push(`${i + 1}. ${r.cite}${refLink(r) ? ' ' + refLink(r) : ''} — _${r.use}_ (bukti ${r.ev})`));

  /* 12. permintaan analisis */
  h('## 12. Permintaan analisis untuk Claude');
  L.push(
    [
      'Tolong analisis laporan simulasi ini bersama konteks tank di Project:',
      '1. Prioritaskan masalah: keselamatan (meluap, pompa kering) → kestabilan hidrolik → kebutuhan biota → efisiensi energi.',
      '2. Untuk tiap masalah, beri langkah penyetelan berurutan dengan nilai target (bukaan valve, daya pompa, arah duckbill/wavemaker, dll.) dan alasan fisikanya.',
      '3. Bedakan saran berbasis riset (A), teknik/model (B), dan kebiasaan praktisi (C); sebutkan pustaka yang relevan.',
      '4. Sebutkan pengukuran nyata yang perlu saya lakukan untuk memvalidasi model (mis. debit return, level saat padam, arus di posisi karang, salinitas dengan refraktometer).',
      '5. Bila ada laporan sebelumnya di Project, bandingkan perubahannya.',
    ].join('\n'),
  );

  /* lampiran JSON */
  h('## Lampiran: data mentah (JSON)');
  const data = {
    versi: c.version,
    dibuat: date.toISOString(),
    profil: app.profile,
    parameter: { P, NZL, WM, V: { cfd: V.cfd, wm: V.wm, rock: V.rock, sand: V.sand } },
    hidrolik: {
      t: S.t, HT: S.HT, HB: P.box ? S.HB : null, H1: S.H1, H2: S.H2, H3: S.H3, HP: S.HP,
      debit_Lph: { siphon: q.s * 3.6, return: q.r * 3.6, skimmer: q.k * 3.6, bawah: q.b * 3.6 },
      head_cm: { pompa: q.hp, statis: q.hs }, udaraU: S.air.slice(0, P.n), siphonPutus: S.brk.slice(0, P.n),
      levelPadam: eqL, volumeAir_L: litres, salinitas: sal, ato_L: S.ato / 1000, tumpah_L: S.spill / 1000,
    },
    cfd: { ...cfd, valid: flowValid, statistik: st },
    saran: analysis.findings.map(({ id, cat, level, title, now, target, ev, refs }) => ({ id, cat, level, title, now, target, ev, refs })),
    ujiPulsa: pulse ? { ...pulse } : null,
    titikSeimbang: eq ? { best: eq.best, critical: eq.critical, maxSpd: eq.maxSpd, rows: eq.rows } : null,
    listrik: { avgW: energy.avgW, kwhBulan: energy.kwhMonth, biayaBulan: energy.costMonth },
  };
  L.push('```json', JSON.stringify(data, (key, v) => (typeof v === 'number' ? +v.toPrecision(5) : v), 1), '```');
  return L.join('\n') + '\n';
}

/** Template instruksi untuk Claude Project (ditempel di "Project instructions"). */
export function projectInstructions() {
  return `Kamu membantu saya mendesain dan merawat reef tank 50×25×30 cm dengan back filter 50×11×30 cm (kapas → protein skimmer → media bio → chamber pompa), siphon U-pipe dengan surface skimmer, pompa return + duckbill, ATO, dan opsional wavemaker.

Saya akan mengunggah "Laporan analisis simulasi reef tank" (Markdown + lampiran JSON) dari aplikasi simulasi saya. Cara membacanya:
- Angka di laporan adalah keluaran model (hidrolik lumped + CFD 3D kisi 1–1,5 cm), bukan pengukuran. Perlakukan sebagai perkiraan dan arah perbaikan; minta pengukuran nyata bila keputusan penting bergantung padanya.
- Satuan: cm, L, L/jam, cm/s, ppt, menit. "Zona mati" = laju rata-rata < 1 cm/s. "Efisiensi pertukaran air" 50% = tercampur sempurna. "t95" = waktu sampai tank homogen 95% setelah pulsa pewarna.
- Tiap saran aplikasi punya tingkat bukti: A = riset peer-reviewed, B = rumus teknik/model, C = kebiasaan praktisi. Jangan menyajikan C seolah-olah hasil riset.

Cara menjawab:
1. Bahasa Indonesia; istilah teknis baku boleh dalam bahasa Inggris.
2. Urutan prioritas: keselamatan (meluap, pompa kering, listrik padam) → kestabilan hidrolik → kebutuhan biota (sesuai profil di laporan) → efisiensi energi/biaya.
3. Beri langkah konkret dan berurutan dengan nilai target (bukaan valve %, daya pompa %, arah duckbill/wavemaker dalam derajat, posisi), plus alasan fisikanya secara singkat.
4. Sertakan rujukan ilmiah bila menyangkut biologi karang/ikan atau kimia air; gunakan pustaka di laporan bila relevan dan beri tahu bila sebuah klaim belum didukung pustaka.
5. Sebutkan apa yang perlu diukur langsung untuk memvalidasi (debit dengan gelas ukur + stopwatch, level saat uji padam, arus dengan pewarna/partikel, salinitas dengan refraktometer terkalibrasi, suhu, KH, Ca, Mg, NO₃, PO₄).
6. Bila ada beberapa laporan di Project, bandingkan versi dan tanggalnya, lalu jelaskan dampak perubahan pengaturan.
7. Bila data yang dibutuhkan tidak ada di laporan (mis. jenis ikan/karang, suhu, parameter kimia), tanyakan dulu sebelum menyimpulkan.`;
}
