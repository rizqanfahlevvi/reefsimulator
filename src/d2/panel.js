/**
 * Desain 2 — panel: debit & gate valve, hasil (muka air, pembagian aliran, peringatan), diagram
 * potongan, tabel debit, batas kapasitas, saat padam, ukuran (bisa diubah), cek kaca, daftar potong.
 */
import * as M from './model.js';
import { diagramSVG } from './diagram.js';

const f1 = (v, d = 1) => (+v).toFixed(d).replace('.', ',');
const Lh = (cm3s) => `${Math.round(cm3s * 3.6)} L/jam`;
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/** Daftar parameter yang bisa diubah, per kelompok. mm: tampil & diketik dalam mm. */
const GROUPS = [
  {
    title: 'Tank & kaca',
    rows: [
      ['tankW', 'Panjang tank'],
      ['tankD', 'Lebar tank (depan–belakang)'],
      ['tankH', 'Tinggi tank'],
      ['glassT', 'Kaca depan & samping', 'mm'],
      ['backT', 'Kaca belakang (dibor)', 'mm'],
    ],
  },
  {
    title: 'Kotak sisir (di dalam tank)',
    rows: [
      ['L', 'Panjang kotak (dalam & luar)'],
      ['inW', 'Lebar kotak dalam'],
      ['inH', 'Tinggi kotak dalam'],
      ['acrT', 'Tebal akrilik', 'mm'],
      ['combTop', 'Celah mulai dari tepi atas'],
      ['combLen', 'Panjang celah'],
      ['slotW', 'Lebar celah', 'mm'],
      ['slotPitch', 'Jarak antar celah (pusat)'],
      ['combMargin', 'Celah pertama dari ujung (min.)'],
    ],
  },
  {
    title: 'Lubang penghubung (bor kaca)',
    rows: [
      ['holeN', 'Jumlah lubang', 'n'],
      ['holeSize', 'Ukuran bulkhead', 'bh'],
      ['holeY', 'Pusat lubang dari dasar tank'],
      ['holeSp', 'Jarak antar pusat lubang'],
    ],
  },
  {
    title: 'Kotak luar & Bean Animal',
    rows: [
      ['outW', 'Lebar kotak luar'],
      ['outH', 'Tinggi kotak luar'],
      ['mainSize', 'Siphon utama', 'bh'],
      ['mainGap', 'Mulut siphon di atas alas'],
      ['openSize', 'Jalur terbuka', 'bh'],
      ['openTop', 'Bibir jalur terbuka di atas alas'],
      ['emSize', 'Jalur darurat', 'bh'],
      ['emTop', 'Bibir jalur darurat di atas alas'],
      ['sumpDrop', 'Muka air sump di bawah kotak luar (perkiraan)'],
      ['pipeLen', 'Panjang pipa siphon ke sump (perkiraan)'],
    ],
  },
  {
    title: 'Return',
    rows: [
      ['retSize', 'Ukuran bulkhead return', 'bh'],
      ['retTop', 'Pusat lubang dari tepi atas kaca'],
      ['retGap', 'Pusat lubang dari ujung kaca'],
      ['tipDrop', 'Ujung nozzle di bawah pusat lubang'],
      ['breakHole', 'Lubang pemutus siphon Ø 4 mm', 'tg'],
    ],
  },
];

export function buildPanel(root, { onChange, onReset }) {
  root.textContent = '';
  const tabs = el('div', 'tabs');
  tabs.setAttribute('role', 'tablist');
  const secs = {};
  for (const [k, name] of [
    ['hasil', 'Hasil'],
    ['ukuran', 'Ukuran'],
    ['kerja', 'Gambar kerja'],
  ]) {
    const b = el('button', 'tab', name);
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.dataset.k = k;
    tabs.appendChild(b);
    const s = el('section');
    s.setAttribute('role', 'tabpanel');
    secs[k] = s;
  }
  root.appendChild(tabs);
  for (const s of Object.values(secs)) root.appendChild(s);
  const show = (k) => {
    for (const b of tabs.children) {
      const on = b.dataset.k === k;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on);
    }
    for (const [kk, s] of Object.entries(secs)) s.hidden = kk !== k;
  };
  tabs.addEventListener('click', (e) => {
    const b = e.target.closest('.tab');
    if (b) show(b.dataset.k);
  });
  show('hasil');

  /* ---------- Hasil ---------- */
  const H = secs.hasil;
  const cQ = el('div', 'card');
  H.appendChild(cQ);
  const qRow = el('label', 'row');
  qRow.append(el('span', '', 'Debit sampai ke tank'), el('b'));
  const qIn = el('input');
  Object.assign(qIn, { type: 'range', min: M.RANGES.Q[0], max: M.RANGES.Q[1], step: M.RANGES.Q[2] });
  qIn.setAttribute('aria-label', 'Debit (L/jam)');
  const autoTg = el('label', 'tg');
  const autoIn = el('input');
  autoIn.type = 'checkbox';
  autoTg.append(autoIn, el('span', '', 'Gate valve disetel otomatis (jalur terbuka menetes, darurat kering)'));
  const gRow = el('label', 'row');
  gRow.append(el('span', '', 'Bukaan gate valve siphon'), el('b'));
  const gIn = el('input');
  Object.assign(gIn, { type: 'range', min: 10, max: 100, step: 1 });
  gIn.setAttribute('aria-label', 'Bukaan gate valve (%)');
  cQ.append(qRow, qIn, autoTg, gRow, gIn);
  qIn.addEventListener('input', () => onChange({ Q: +qIn.value }));
  gIn.addEventListener('input', () => onChange({ gate: +gIn.value / 100 }, { auto: false }));
  autoIn.addEventListener('change', () => onChange({}, { auto: autoIn.checked }));

  const cStat = el('div', 'card d2-status');
  const statHead = el('div', 'd2-head');
  const flagList = el('ul', 'd2-flags');
  const grid = el('div', 'grid2');
  cStat.append(statHead, flagList, grid);
  H.appendChild(cStat);

  const cDia = el('div', 'card');
  cDia.appendChild(el('h2', '', 'Potongan jalur air'));
  const dia = el('div', 'd2-dia');
  cDia.appendChild(dia);
  H.appendChild(cDia);

  const cTab = el('div', 'card');
  cTab.appendChild(el('h2', '', 'Muka air per debit'));
  const tbl = el('table', 'el d2-tbl');
  cTab.appendChild(tbl);
  cTab.appendChild(el('p', 'note', 'S / T / D = siphon / jalur terbuka / darurat (L/jam). Gate valve mengikuti pengaturan di atas.'));
  H.appendChild(cTab);

  const cLim = el('div', 'card');
  cLim.appendChild(el('h2', '', 'Batas kapasitas'));
  const lim = el('table', 'el');
  cLim.appendChild(lim);
  H.appendChild(cLim);

  const cOut = el('div', 'card');
  cOut.appendChild(el('h2', '', 'Saat listrik padam (turun ke sump)'));
  const dd = el('table', 'el');
  const ddNote = el('p', 'note');
  cOut.append(dd, ddNote);
  H.appendChild(cOut);

  /* ---------- Ukuran ---------- */
  const U = secs.ukuran;
  const inputs = {};
  const cU = el('div', 'card');
  U.appendChild(cU);
  GROUPS.forEach((grp, gi) => {
    const det = el('details');
    if (gi < 2) det.open = true;
    det.appendChild(el('summary', '', grp.title));
    for (const [key, label, kind] of grp.rows) {
      if (kind === 'tg') {
        const tg = el('label', 'tg');
        const cb = el('input');
        cb.type = 'checkbox';
        cb.addEventListener('change', () => onChange({ [key]: cb.checked }));
        tg.append(cb, el('span', '', label));
        det.appendChild(tg);
        inputs[key] = { set: (v) => (cb.checked = !!v) };
        continue;
      }
      if (kind === 'bh') {
        const row = el('label', 'row');
        const sel = el('select');
        for (const [sz, b] of Object.entries(M.BULKHEADS)) {
          const o = el('option', '', `${b.label} (lubang Ø ${f1(b.hole)} cm)`);
          o.value = sz;
          sel.appendChild(o);
        }
        sel.addEventListener('change', () => onChange({ [key]: +sel.value }));
        row.append(el('span', '', label), sel);
        det.appendChild(row);
        inputs[key] = { set: (v) => (sel.value = String(v)) };
        continue;
      }
      const [lo, hi, st] = M.RANGES[key];
      const k = kind === 'mm' ? 10 : 1;
      const unit = kind === 'mm' ? 'mm' : kind === 'n' ? '' : 'cm';
      const row = el('label', 'row');
      const num = el('input', 'num');
      Object.assign(num, { type: 'number', min: lo * k, max: hi * k, step: st * k, inputMode: 'decimal' });
      const right = el('span', 'd2-num');
      right.append(num, el('small', '', unit));
      row.append(el('span', '', label), right);
      const rg = el('input');
      Object.assign(rg, { type: 'range', min: lo * k, max: hi * k, step: st * k });
      rg.setAttribute('aria-label', label);
      const push = (v) => {
        if (!Number.isFinite(v)) return;
        onChange({ [key]: v / k });
      };
      rg.addEventListener('input', () => push(+rg.value));
      num.addEventListener('change', () => push(parseFloat(String(num.value).replace(',', '.'))));
      det.append(row, rg);
      inputs[key] = {
        set: (v) => {
          const d = st * k < 1 ? (st * k < 0.1 ? 2 : 1) : 0;
          const s = (v * k).toFixed(d);
          if (document.activeElement !== num) num.value = s;
          rg.value = v * k;
        },
      };
    }
    cU.appendChild(det);
  });
  const rs = el('button', '', 'Kembalikan ukuran bawaan');
  rs.type = 'button';
  rs.addEventListener('click', onReset);
  const btns = el('div', 'btns');
  btns.appendChild(rs);
  cU.appendChild(btns);
  U.appendChild(
    noteCard(
      'Ukuran dalam cm dari luar ke luar. Kotak luar menempel di balik kaca belakang, ujung kiri kanannya sejajar dengan kotak dalam. Ukuran bulkhead 25 & 32 mm masih perkiraan — ukur ulir & mur asli sebelum memotong/membor.',
    ),
  );

  /* ---------- Gambar kerja ---------- */
  const K = secs.kerja;
  const cChk = el('div', 'card');
  cChk.appendChild(el('h2', '', 'Cek kaca & lubang'));
  const chk = el('ul', 'd2-checks');
  cChk.appendChild(chk);
  K.appendChild(cChk);
  const cCut = el('div', 'card');
  const cutHead = el('div', 'd2-head');
  cutHead.appendChild(el('h2', '', 'Daftar potong & bor (cm)'));
  const copy = el('button', '', 'Salin teks');
  copy.type = 'button';
  cutHead.appendChild(copy);
  const cut = el('div', 'd2-cut');
  cCut.append(cutHead, cut);
  K.appendChild(cCut);
  K.appendChild(
    noteCard(
      'Patokan: jarak tepi lubang ke tepi kaca & antar lubang ≥ max(2 × tebal kaca, Ø lubang); sudut potongan akrilik dibulatkan; lubang kaca dibor tukang kaca (mata bor intan + air), jangan dipotong gerinda. Tebal kaca memakai teori pelat (σ 19,2 MPa, faktor keamanan anjuran 3,8).',
    ),
  );
  let cutText = '';
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(cutText);
      copy.textContent = 'Tersalin ✓';
    } catch {
      copy.textContent = 'Gagal menyalin';
    }
    setTimeout(() => (copy.textContent = 'Salin teks'), 1600);
  });

  function noteCard(text) {
    const c = el('div', 'card');
    c.appendChild(el('p', 'note', text));
    return c;
  }
  const row = (tb, cells, head = false) => {
    const tr = el('tr');
    for (const c of cells) tr.appendChild(el(head ? 'th' : 'td', '', c));
    tb.appendChild(tr);
    return tr;
  };

  let lastLimKey = '';
  return {
    render(p, s, st) {
      const g = M.geometry(p);
      qRow.querySelector('b').textContent = `${Math.round(p.Q)} L/jam`;
      qIn.value = p.Q;
      autoIn.checked = st.auto;
      gRow.querySelector('b').textContent = `${Math.round(p.gate * 100)}% · K ${f1(M.gateK(p.gate))}`;
      gIn.value = Math.round(p.gate * 100);
      gIn.disabled = st.auto;
      for (const [k, inp] of Object.entries(inputs)) inp.set(p[k]);

      // status
      const level = !s.ok ? 'bad' : s.flags.length ? 'warn' : 'ok';
      statHead.textContent = '';
      const badge = el('b', 'd2-badge ' + level, level === 'ok' ? 'Aman' : level === 'warn' ? 'Perlu disetel' : 'Meluap');
      statHead.append(badge, el('span', '', ` pada ${Math.round(s.Q)} L/jam`));
      flagList.textContent = '';
      for (const fl of s.flags) flagList.appendChild(el('li', '', fl));
      flagList.hidden = !s.flags.length;
      grid.textContent = '';
      const m = (k, v, cls = '') => {
        const d = el('div', 'm ' + cls);
        d.append(el('span', '', k), el('b', '', v));
        grid.appendChild(d);
      };
      m('Muka air tank', `${f1(s.hTank)} cm`, s.ok ? '' : 'bad');
      m('Sisa ke bibir kaca', `${f1(p.tankH - s.hTank)} cm`);
      m('Kotak dalam', `${f1(s.hIn)} cm`);
      m('Sisir', s.combFree ? 'jatuh bebas' : 'tenggelam', s.combFree ? '' : 'warn');
      m('Kotak luar', `${f1(s.hOut)} cm`, s.outFull ? 'bad' : '');
      m('Siphon utama', Lh(s.flows.main));
      m('Jalur terbuka', Lh(s.flows.open), s.flows.open < 0.3 ? 'warn' : '');
      m('Jalur darurat', s.flows.em > 0.5 ? Lh(s.flows.em) : 'kering', s.flows.em > 0.5 ? 'warn' : '');

      dia.innerHTML = diagramSVG(g, s);

      // tabel debit
      tbl.textContent = '';
      row(tbl, ['Debit', 'Tank', 'Dalam', 'Luar', 'S / T / D', ''], true);
      const qs = [400, 600, 800, 1000, 1200, 1400, 1600, 1800];
      if (!qs.includes(Math.round(p.Q))) qs.push(Math.round(p.Q));
      qs.sort((a, b) => a - b);
      for (const q of qs) {
        const gate = st.auto ? M.autoGate(p, q) : p.gate;
        const r = M.solve(p, q, gate);
        const tr = row(tbl, [
          q,
          f1(r.hTank),
          f1(r.hIn),
          f1(r.hOut),
          `${Math.round(r.flows.main * 3.6)} / ${Math.round(r.flows.open * 3.6)} / ${Math.round(r.flows.em * 3.6)}`,
          !r.ok ? '✕' : r.flags.length ? '!' : '✓',
        ]);
        tr.className = (!r.ok ? 'bad' : r.flags.length ? 'warn' : 'ok') + (q === Math.round(p.Q) ? ' cur' : '');
      }

      // batas (mahal sedikit: hanya bila parameter berubah)
      const key = JSON.stringify(p);
      if (key !== lastLimKey) {
        lastLimKey = key;
        const L = M.limits(p);
        lim.textContent = '';
        row(lim, ['Sisir mulai tenggelam', `${L.combFree} L/jam`]);
        row(lim, ['Jalur darurat mulai mengalir (gate saat ini)', `${L.emergency} L/jam`]);
        row(lim, ['Debit desain (gate terbuka penuh, darurat masih kering)', `${L.design} L/jam`]);
        row(lim, ['Siphon tersumbat: terbuka + darurat sanggup', `${L.backupOnly} L/jam`]);
        row(lim, ['Tank meluap mulai', `${L.overflow} L/jam`]);
        const d = M.drainDown(p);
        dd.textContent = '';
        row(dd, ['Tank (di atas dasar celah sisir)', `${f1(d.tank)} L`]);
        row(dd, ['Kotak dalam (sampai lubang penghubung)', `${f1(d.inner)} L`]);
        row(dd, ['Kotak luar (sampai mulut siphon)', `${f1(d.outer)} L`]);
        row(dd, ['Isi pipa siphon', `${f1(d.pipe)} L`]);
        row(dd, [p.breakHole ? 'Tersedot balik lewat return (ada lubang pemutus)' : 'Tersedot balik lewat return (TANPA lubang pemutus)', `${f1(d.ret)} L`]);
        const tr = row(dd, ['Total', `${f1(d.total)} L`]);
        tr.className = 'tot';
        ddNote.textContent = `Ruang kosong di sump nanti harus ≥ ${f1(d.total)} L + isi pipa return (bergantung pada sump & pompa). ` + (p.breakHole ? '' : 'Tambahkan lubang pemutus siphon supaya tank tidak terkuras lewat return.');
        // cek & daftar potong
        chk.textContent = '';
        for (const c of M.checks(p)) {
          const li = el('li', c.level);
          li.append(el('b', '', c.level === 'ok' ? '✓' : c.level === 'warn' ? '!' : '✕'), el('span', '', c.text));
          chk.appendChild(li);
        }
        cut.textContent = '';
        const lines = [];
        for (const sec of M.cutList(p)) {
          cut.appendChild(el('h3', '', sec.title));
          const ul = el('ul');
          for (const it of sec.items) ul.appendChild(el('li', '', it));
          cut.appendChild(ul);
          lines.push(sec.title, ...sec.items.map((x) => '- ' + x), '');
        }
        cutText = `Overflow sisir — tank ${p.tankW}×${p.tankD}×${p.tankH} cm (ukuran cm)\n\n` + lines.join('\n');
        const cs = M.checks(p).filter((c) => c.level !== 'ok');
        const tk = tabs.querySelector('[data-k="kerja"]');
        tk.dataset.badge = cs.length ? String(cs.length) : '';
        tk.dataset.level = cs.some((c) => c.level === 'bad') ? 'bad' : 'warn';
      }
    },
  };
}
