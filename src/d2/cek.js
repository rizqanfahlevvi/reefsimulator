/**
 * Tab "Cek & debit" di halaman Desain 2. Halaman lain (Model 3D, Gambar Kerja, Spesifikasi) adalah
 * desain asli pemilik tanpa perubahan (public/d2/overflow-sisir.js). Tab ini hanya: slider debit,
 * muka air pada debit itu, tabel per debit, dan peringatan. Ukuran final, tidak bisa diubah.
 */
import './cek.css';
import { FINAL, Q_RANGE, levels, warnings, sumpSpace } from './model.js';

const KEY = 'reefsim:desain2';
const root = document.getElementById('tabcek');
const fc = (v, d = 1) => (+v).toFixed(d).replace('.', ',');
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

function loadQ() {
  try {
    const q = +JSON.parse(localStorage.getItem(KEY) || '{}').Q;
    if (Number.isFinite(q)) return Math.min(Q_RANGE[1], Math.max(Q_RANGE[0], q));
  } catch {
    /* penyimpanan rusak/terblokir */
  }
  return 1000;
}
let Q = loadQ();
const lv = levels(FINAL);
const geo = lv.geo;

/* ---------- kerangka ---------- */
const cQ = el('div', 'ctl');
const lab = el('label', 'sl');
const qTxt = el('b', 'cek-q');
const range = el('input');
Object.assign(range, { type: 'range', min: Q_RANGE[0], max: Q_RANGE[1], step: Q_RANGE[2], value: Q });
range.setAttribute('aria-label', 'Debit return (L/jam)');
lab.append(el('span', '', 'Debit return'), range, qTxt);
cQ.append(lab, el('p', 'cek-note', 'Debit yang benar-benar sampai ke tank (setelah rugi pipa). Ukuran overflow & tank mengikuti desain final, tidak diubah di sini.'));

const cNow = el('div', 'card');
const hNow = el('h2');
const tNow = el('table');
const scNow = el('div', 'sc');
scNow.appendChild(tNow);
cNow.append(hNow, scNow);

const cWarn = el('div', 'card');
const hWarn = el('h2', '', 'Peringatan desain');
const ulWarn = el('ul', 'cek-warn');
cWarn.append(hWarn, ulWarn);

const cTab = el('div', 'card');
const tRows = el('table');
const scRows = el('div', 'sc');
scRows.appendChild(tRows);
cTab.append(el('h2', '', 'Muka air per debit'), scRows);
cTab.append(el('p', 'cek-note', 'Angka dari rumus yang sama dengan tabel "Perkiraan tinggi air saat jalan" di tab Spesifikasi (weir/orifice, bisa meleset ±0,5 cm). Kotak dalam/luar = cm dari dasar luar kotak masing-masing.'));

root.append(cQ, cNow, cWarn, cTab);

/* ---------- isi ---------- */
const tr = (tb, cells, th = false) => {
  const r = el('tr');
  for (const c of cells) r.appendChild(el(th ? 'th' : 'td', '', c));
  tb.appendChild(r);
  return r;
};

function render() {
  const s = lv.at(Q);
  qTxt.textContent = `${Q.toLocaleString('id-ID')} L/jam`;
  hNow.textContent = `Muka air pada ${Q.toLocaleString('id-ID')} L/jam`;
  tNow.textContent = '';
  tr(tNow, ['Air di tank', s.over ? 'di atas celah sisir (meluap lewat bibir kotak dalam)' : `${fc(s.tank)} cm dari dasar tank · ${fc(s.fromRim)} cm dari bibir`]);
  tr(tNow, ['Kotak dalam', `${s.free ? 'jatuh bebas' : 'celah terendam'} (${fc(s.iz)} cm)`]);
  tr(tNow, ['Kotak luar', `${s.outOk ? 'aman' : 'tertahan'} (${fc(s.oz)} cm)`]);
  tr(tNow, ['Lewat celah terbuka', `±${Math.round(s.nShare * 100)}% (sisanya lewat 2 bulkhead penghubung)`]);
  tr(tNow, ['Sisir jatuh bebas sampai', `±${Math.floor(lv.qFree / 100) * 100} L/jam`]);
  tr(tNow, ['Batas kotak luar (4 bulkhead alas)', `±${Math.floor(lv.qOuter / 50) * 50} L/jam`]);
  tr(tNow, ['Ruang kosong sump saat padam', `minimal ±${sumpSpace(Q)} L`]);

  ulWarn.textContent = '';
  const ws = warnings(Q);
  const nBad = ws.filter((w) => w.level === 'bad').length;
  const nWarn = ws.filter((w) => w.level === 'warn').length;
  hWarn.textContent = `Peringatan desain (${nBad} serius, ${nWarn} perlu dicek)`;
  for (const w of ws) {
    const li = el('li', w.level);
    li.append(el('b', 'ic', w.level === 'ok' ? 'ℹ' : w.level === 'warn' ? '⚠' : '✕'));
    const body = el('div');
    body.append(el('b', '', w.title), el('span', '', w.text));
    li.appendChild(body);
    ulWarn.appendChild(li);
  }

  tRows.textContent = '';
  tr(tRows, ['Debit return', 'Air di tank', 'Dari bibir', 'Kotak dalam', 'Kotak luar'], true);
  const qs = [500, 750, 1000, 1250, 1500, 2000, 3000];
  if (!qs.includes(Q)) qs.push(Q);
  qs.sort((a, b) => a - b);
  for (const q of qs) {
    const r = lv.at(q);
    const row = tr(tRows, [
      `${q.toLocaleString('id-ID')} L/jam`,
      r.over ? 'di atas celah' : `${fc(r.tank)} cm`,
      r.over ? `< ${fc(FINAL.combTop)} cm` : `${fc(r.fromRim)} cm`,
      `${r.free ? 'jatuh bebas' : 'terendam'} (${fc(r.iz)})`,
      `${r.outOk ? 'aman' : 'tertahan'} (${fc(r.oz)})`,
    ]);
    if (q === Q) row.className = 'cur';
    if (r.over || !r.outOk) row.classList.add('bad');
    else if (!r.free) row.classList.add('warn');
  }
  // lencana jumlah peringatan serius di tombol tab
  const tab = document.querySelector('.tab[data-tab="tabcek"]');
  if (tab) tab.dataset.n = nBad ? String(nBad) : '';
}

let saveT = 0;
range.addEventListener('input', () => {
  Q = +range.value;
  render();
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ v: 2, Q }));
    } catch {
      /* mode privat */
    }
  }, 300);
});
render();

// desain asli hanya memulihkan 3 tab dari alamat (#m-...) dan saat mulai bisa menimpa alamat itu,
// jadi alamat awal dibaca dari entri navigasi
const startUrl = performance.getEntriesByType?.('navigation')?.[0]?.name || location.href;
if (startUrl.endsWith('#m-cek') || location.hash === '#m-cek') document.querySelector('.tab[data-tab="tabcek"]')?.click();

