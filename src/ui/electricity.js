/** Estimasi konsumsi listrik dan biaya bulanan (tarif PLN). */
import { app } from '../state.js';
import { fmt, rupiah, $, el } from '../util/format.js';

export const EL = {
  tarif: 1444.7,
  rows: [
    { id: 'pump', n: 'Pompa return', w: 6, h: 24 },
    { id: 'air', n: 'Pompa udara skimmer', w: 3, h: 24 },
    { id: 'skp', n: 'Pompa skimmer venturi', w: 5, h: 24 },
    { id: 'led', n: 'Lampu LED', w: 20, h: 9 },
    { id: 'wm', n: 'Wavemaker', w: 4, h: 24 },
    { id: 'fan', n: 'Kipas pendingin', w: 3, h: 10 },
    { id: 'ato', n: 'Pompa ATO', w: 3, h: 0.2 },
  ],
};

const TARIF = [
  [1444.7, '1.300–2.200 VA · Rp 1.444,70'],
  [1352, '900 VA nonsubsidi · Rp 1.352'],
  [605, '900 VA subsidi · Rp 605'],
  [415, '450 VA subsidi · Rp 415'],
  [1699.53, '≥3.500 VA · Rp 1.699,53'],
];

/** Konsumsi & biaya listrik (fungsi murni; dipakai panel dan laporan analisis). */
export function energyStats(a = app, E = EL) {
  const { P, V, LOOK } = a;
  let wh = 0;
  const rows = E.rows.map((r) => {
    let w = r.w;
    const off =
      (r.id === 'wm' && !V.wm) || (r.id === 'air' && LOOK.skim !== 'air') || (r.id === 'skp' && LOOK.skim !== 'ven') || (r.id === 'led' && LOOK.lamp === 'off');
    if (r.id === 'pump') w *= Math.pow(P.spd, 3);
    if (r.id === 'led') w *= LOOK.li / 80;
    if (off) w = 0;
    wh += w * r.h;
    return { id: r.id, n: r.n, w, h: r.h, off, kwhMonth: (w * r.h * 30) / 1000 };
  });
  const kwhMonth = (wh * 30) / 1000;
  return { rows, avgW: wh / 24, kwhMonth, costMonth: kwhMonth * E.tarif, costYear: (kwhMonth * E.tarif * 365) / 30, tarif: E.tarif };
}

export function buildElectricity() {
  const root = $('elec');
  root.append(el('h2', { textContent: 'Estimasi listrik' }));
  const num = (v, step, fn, wide = false) => {
    const e = el('input', { type: 'number', min: 0, step, value: v, inputMode: 'decimal', className: 'num' + (wide ? ' wide' : '') });
    e.addEventListener('input', () => {
      const x = parseFloat(e.value);
      fn(Number.isFinite(x) && x >= 0 ? x : 0);
      update();
    });
    return e;
  };
  const tb = el('table', { className: 'el' });
  tb.append(el('tr', {}, ['Alat', 'Watt', 'Jam/hari', 'kWh/bln'].map((t) => el('th', { textContent: t }))));
  for (const r of EL.rows) {
    r.out = el('td');
    tb.append(
      el('tr', {}, [
        el('td', { textContent: r.n }),
        el('td', {}, [num(r.w, 0.5, (x) => (r.w = x))]),
        el('td', {}, [num(r.h, 0.1, (x) => (r.h = Math.min(24, x)))]),
        r.out,
      ]),
    );
  }
  root.append(tb);
  root.append(el('label', { className: 'row', textContent: 'Tarif PLN per kWh', htmlFor: 'tarifSel' }));
  const opts = TARIF.map(([v, t]) => el('option', { value: v, textContent: t }));
  opts.push(el('option', { value: 'custom', textContent: 'Tarif lain (isi manual)' }));
  const sel = el('select', { id: 'tarifSel', style: 'flex:1;min-width:0' }, opts);
  const syncSel = () => (sel.value = TARIF.some(([v]) => v === EL.tarif) ? String(EL.tarif) : 'custom');
  const ti = num(
    EL.tarif,
    0.01,
    (x) => {
      EL.tarif = x;
      syncSel();
    },
    true,
  );
  ti.ariaLabel = 'Tarif per kWh';
  syncSel();
  sel.addEventListener('change', () => {
    if (sel.value === 'custom') {
      ti.focus();
      return;
    }
    EL.tarif = +sel.value;
    ti.value = EL.tarif;
    update();
  });
  root.append(el('div', { style: 'display:flex;gap:6px' }, [sel, ti]));
  const out = {};
  const g = el('div', { className: 'grid2', style: 'margin-top:8px' });
  for (const [id, label] of [
    ['eW', 'Daya rata-rata'],
    ['eK', 'Energi per bulan'],
    ['eM', 'Biaya per bulan'],
    ['eY', 'Biaya per tahun'],
  ]) {
    out[id] = el('b');
    g.append(el('div', { className: 'm' }, [el('span', { textContent: label }), out[id]]));
  }
  root.append(g);
  root.append(
    el('p', {
      className: 'note',
      style: 'margin-top:8px',
      textContent:
        'Watt pompa return mengikuti slider daya pompa (pangkat tiga, hukum afinitas). Wavemaker hanya dihitung bila diaktifkan. Tarif per November 2026, belum termasuk pajak penerangan jalan. Ganti watt sesuai label alat Anda.',
    }),
  );

  function update() {
    const e = energyStats();
    EL.rows.forEach((r, i) => {
      const x = e.rows[i];
      const t = x.off ? 'mati' : fmt(x.kwhMonth, 2);
      if (r.out.textContent !== t) r.out.textContent = t;
    });
    out.eW.textContent = fmt(e.avgW, 1) + ' W';
    out.eK.textContent = fmt(e.kwhMonth, 1) + ' kWh';
    out.eM.textContent = rupiah(e.costMonth);
    out.eY.textContent = rupiah(e.costYear);
  }
  return { update };
}
