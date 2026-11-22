/**
 * Kartu status surface skimmer (tab Tank → Siphon & surface skimmer): penampang kepala skimmer
 * (muka air, bibir, genangan di dalam kepala skimmer, pipa), angka debit, status dengan bahasa
 * sederhana, dan tombol zoom ke skimmer di tampilan 3D. Diperbarui ±5×/detik saat terlihat.
 */
import { app } from '../state.js';
import { G, GEO } from '../physics/constants.js';
import { isSplit, rimOf, skimmerActive, isFloating, teleState, teleRange } from '../physics/hydraulics.js';
import { el, fmt } from '../util/format.js';

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};
const Lh = (q) => Math.round(Math.max(0, q) * 3.6) + ' L/jam';

/**
 * Keadaan skimmer saat ini dalam bentuk ringkas (murni dari app; dipakai kartu & diuji).
 * @returns {{kind: 'none'|'box'|'tee'|'split', level: 'ok'|'info'|'warn'|'bad', title: string, tip: string, rim: number, HT: number, Hc: number, zcb: number, rows: Array<[string, string]>}}
 */
export function skimmerState(a = app) {
  const { S, P } = a;
  const base = { rim: 0, HT: S.HT, Hc: S.HT, zcb: 0, rows: [] };
  if (P.box) return { ...base, kind: 'box', level: 'info', title: 'Overflow box sebagai skimmer', tip: 'Air permukaan masuk lewat sisir overflow box; pengaturan skimmer di intake tidak dipakai.' };
  const split = isSplit(P);
  const i = split ? 1 : 0;
  const rim = rimOf(S, P, i);
  if (!split && !skimmerActive(P, rim)) {
    return {
      ...base,
      kind: 'none',
      level: 'info',
      title: P.sk === 0 ? 'Tanpa surface skimmer' : 'Skimmer tidak aktif',
      tip: P.sk === 0 ? 'Semua air diambil dari intake bawah; lapisan film di permukaan tidak tersedot.' : 'Bibir mangkuk terlalu dekat dengan tee/intake bawah. Naikkan bibir atau intake.',
    };
  }
  const zcb = rim - GEO.CUPD;
  const Hc = Math.min(S.Hc[i], S.HT);
  const above = (S.HT - rim) * 10; // mm
  const pool = Math.max(0, (Hc - zcb) * 10); // mm genangan di kepala skimmer
  const D = P.D;
  const vT = 0.35 * Math.sqrt(G * D);
  const rows = [['Air di atas bibir', above >= 0 ? `${fmt(above, 0)} mm` : `bibir ${fmt(-above, 0)} mm di atas air!`]];
  let level = 'ok';
  let title = 'Skimmer bekerja';
  let tip = '';
  // tipe 3: kepala mentok di ujung ruang luncur tidak lagi ikut muka air
  const tele = teleState(S, P);
  if (tele) {
    const { lo, hi } = teleRange(P);
    rows.push(['Ruang luncur', tele === 'free' ? `bebas (${fmt(lo, 1)}–${fmt(hi, 1)} cm)` : tele === 'top' ? 'MENTOK ATAS' : 'MENTOK BAWAH']);
  }
  const teleTip =
    tele === 'top'
      ? ' Kepala mentok di atas ruang luncur sehingga bibir tidak ikut naik: naikkan "Tinggi bibir di tengah ruang luncur" atau perpanjang ruang luncur.'
      : tele === 'bottom'
        ? ' Kepala mentok di dasar ruang luncur (bibir terendam makin dalam): turunkan tengah ruang luncur atau perpanjang ruang luncur.'
        : '';
  if (split) {
    const v = S.vs[1];
    const qsk = S.qk[1] + S.qb[1];
    rows.push(
      ['Genangan di kepala', S.brk[1] ? '–' : pool < 1 ? 'kering' : `${fmt(pool, 0)} mm`],
      ['Pipa skimmer', S.brk[1] ? 'putus' : Lh(qsk)],
      ...(S.qb[1] > 0.2 && !S.brk[1] ? [['· dari lubang', Lh(S.qb[1])]] : []),
      ['Pipa bawah', S.brk[0] ? 'putus' : Lh(S.qb[0])],
      ['Udara di U skimmer', S.brk[1] ? '100%' : Math.round(S.air[1] * 100) + '%'],
      ['Kecepatan (min.)', `${fmt(Math.abs(v), 1)} (${fmt(vT, 1)}) cm/s`],
    );
    if (S.brk[1]) {
      level = 'bad';
      title = 'Siphon skimmer putus';
      tip = P.bleed > 0 || P.fsub >= 7 ? 'Pancing ulang (tombol "Pancing siphon"). Bila putus lagi, perbesar lubang cadangan atau pasang aqualifter di U skimmer.' : 'Siphon menarik lebih banyak dari yang bisa masuk lewat bibir. Coba lubang cadangan 6 mm atau benamkan bibir 8 mm, lalu pancing ulang.';
    } else if (S.airIn[1] > 0) {
      level = 'bad';
      title = 'Kepala skimmer kering — udara tersedot';
      tip = 'Pasokan lewat bibir kurang dari tarikan siphon ("kelaparan"). Tambah lubang cadangan, benamkan bibir lebih dalam, atau batasi tarikan dengan dop berlubang.';
    } else if (S.air[1] > 0.15) {
      level = 'warn';
      title = 'Gelembung menumpuk di puncak U skimmer';
      tip = Math.abs(v) < vT ? `Aliran ${fmt(Math.abs(v), 1)} cm/s di bawah batas ${fmt(vT, 1)} cm/s: gelembung tidak terbawa. Nyalakan aqualifter U skimmer atau tambah aliran (lubang cadangan).` : 'Udara sedang dibuang; tunggu sebentar.';
    } else if (above < 1) {
      level = 'warn';
      title = 'Bibir hampir sejajar muka air';
      tip = 'Sedikit sekali air yang bisa masuk. Turunkan bibir (atau benamkan kepala apung) beberapa mm.';
    } else tip = 'Pasokan lewat bibir cukup untuk tarikan siphon dan gelembung tersapu.';
    if (tele && tele !== 'free') {
      if (level === 'ok') {
        level = 'warn';
        title = tele === 'top' ? 'Kepala skimmer mentok di atas' : 'Kepala skimmer mentok di bawah';
      }
      tip += teleTip;
    }
  } else {
    const share = S.q.s > 1 ? Math.max(0, S.q.k) / S.q.s : 0;
    rows.push(
      ['Genangan di mangkuk', pool < 1 ? 'kering' : `${fmt(pool, 0)} mm`],
      ['Lewat skimmer', `${Lh(S.q.k)} · ${Math.round(share * 100)}%`],
      ['Lewat intake bawah', Lh(S.q.b)],
      ['Udara di puncak U', S.brk[0] ? 'putus' : Math.round(S.air[0] * 100) + '%'],
    );
    if (S.brk[0]) {
      level = 'bad';
      title = 'Siphon putus';
      tip = 'Pancing ulang siphon. Venturi/aqualifter membuang udara di puncak U secara otomatis.';
    } else if (S.airIn[0] > 0) {
      level = 'warn';
      title = 'Mangkuk skimmer menghisap udara';
      tip = 'Level terlalu rendah terhadap bibir. Tutup sedikit valve U-pipe (level naik) atau turunkan bibir mangkuk.';
    } else if (share < 0.2) {
      level = 'info';
      title = 'Sedikit air lewat skimmer';
      tip = 'Kecilkan "Bukaan intake bawah" supaya lebih banyak air permukaan tersedot (≥ 20% debit siphon).';
    } else tip = 'Air permukaan tersedot lewat mangkuk; intake bawah mengambil sisanya.';
    if (tele && tele !== 'free') {
      if (level === 'ok') {
        level = 'warn';
        title = tele === 'top' ? 'Kepala skimmer mentok di atas' : 'Kepala skimmer mentok di bawah';
      }
      tip += teleTip;
    }
  }
  return { kind: split ? 'split' : 'tee', level, title, tip, rim, HT: S.HT, Hc, zcb, rows };
}

/**
 * @param {{onFocus?: () => void}} [o]
 */
export function buildSkimCard({ onFocus } = {}) {
  const root = el('div', { className: 'skim-card' });
  const head = el('div', { className: 'skim-head' });
  const chip = el('span', { className: 'skim-chip' });
  const title = el('b');
  head.append(chip, title);
  /* penampang kepala skimmer (sumbu tegak: ±4 cm di sekitar bibir) */
  const W = 120;
  const H = 120;
  const pic = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'skim-pic', role: 'img', 'aria-label': 'Penampang kepala skimmer' });
  const tank = svg('rect', { x: 0, width: W, fill: 'var(--skim-water)' });
  const cupIn = svg('rect', { x: 44, width: 32, fill: 'var(--skim-cupwater)' });
  const cupL = svg('rect', { x: 40, width: 4, fill: 'var(--skim-wall)' });
  const cupR = svg('rect', { x: 76, width: 4, fill: 'var(--skim-wall)' });
  const cupB = svg('rect', { x: 40, width: 40, height: 4, fill: 'var(--skim-wall)' });
  const pipe = svg('rect', { x: 53, width: 14, fill: 'var(--skim-wall)' });
  const pipeIn = svg('rect', { x: 56, width: 8, fill: 'var(--skim-cupwater)' });
  const surf = svg('line', { x1: 0, x2: W, stroke: 'var(--skim-surf)', 'stroke-width': 2 });
  const rimL = svg('line', { x1: 30, x2: 90, stroke: 'var(--skim-rim)', 'stroke-width': 1.5, 'stroke-dasharray': '3 2' });
  const floatL = svg('ellipse', { cx: 34, rx: 7, ry: 3.5, fill: 'var(--skim-float)' });
  const floatR = svg('ellipse', { cx: 86, rx: 7, ry: 3.5, fill: 'var(--skim-float)' });
  const txtS = svg('text', { x: 3, 'font-size': 8, fill: 'var(--skim-label)' });
  txtS.textContent = 'muka air';
  const txtR = svg('text', { x: 92, 'font-size': 8, fill: 'var(--skim-label)' });
  txtR.textContent = 'bibir';
  const bubbles = svg('g');
  for (let k = 0; k < 4; k++) bubbles.append(svg('circle', { cx: 58 + (k % 2) * 4, r: 1.6, fill: '#fff', stroke: 'var(--skim-wall)', 'stroke-width': 0.5 }));
  pic.append(tank, pipe, pipeIn, cupIn, cupL, cupR, cupB, floatL, floatR, surf, rimL, bubbles, txtS, txtR);
  const rows = el('dl', { className: 'skim-rows' });
  const tip = el('p', { className: 'note skim-tip' });
  const focus = el('button', { type: 'button', className: 'skim-focus', textContent: 'Zoom ke skimmer di 3D' });
  focus.addEventListener('click', () => onFocus?.());
  root.append(head, el('div', { className: 'skim-body' }, [pic, rows]), tip, focus);

  let last = '';
  let t = 0;
  function update() {
    if (!root.isConnected || root.offsetParent === null) return; // tidak terlihat: tidak dihitung
    const s = skimmerState();
    t += 1;
    const key = s.level + s.title;
    if (key !== last) {
      last = key;
      chip.dataset.level = s.level;
      chip.textContent = { ok: 'OK', info: 'Info', warn: 'Perhatian', bad: 'Masalah' }[s.level];
      title.textContent = s.title;
    }
    tip.textContent = s.tip;
    rows.replaceChildren(...s.rows.flatMap(([k, v]) => [el('dt', { textContent: k }), el('dd', { textContent: v })]));
    const show = s.kind === 'tee' || s.kind === 'split';
    pic.style.display = show ? '' : 'none';
    focus.hidden = s.kind === 'none';
    if (!show) return;
    const k = 12; // px per cm
    const cy = 52;
    const y = (h) => Math.max(2, Math.min(H - 2, cy - (h - s.rim) * k));
    const yS = y(s.HT);
    tank.setAttribute('y', yS);
    tank.setAttribute('height', H - yS);
    surf.setAttribute('y1', yS);
    surf.setAttribute('y2', yS);
    txtS.setAttribute('y', Math.max(9, yS - 3));
    const yRim = y(s.rim);
    rimL.setAttribute('y1', yRim);
    rimL.setAttribute('y2', yRim);
    txtR.setAttribute('y', yRim + 3);
    const yBot = y(s.zcb);
    for (const w of [cupL, cupR]) {
      w.setAttribute('y', yRim);
      w.setAttribute('height', Math.max(1, yBot - yRim));
    }
    cupB.setAttribute('y', yBot);
    pipe.setAttribute('y', yBot + 4);
    pipe.setAttribute('height', Math.max(0, H - yBot - 4));
    pipeIn.setAttribute('y', yBot);
    pipeIn.setAttribute('height', Math.max(0, H - yBot));
    const yC = Math.min(yBot, y(s.Hc));
    cupIn.setAttribute('y', yC);
    cupIn.setAttribute('height', Math.max(0, yBot - yC));
    const fl = isFloating(app.P) && !app.P.box;
    floatL.style.display = floatR.style.display = fl ? '' : 'none';
    floatL.setAttribute('cy', yS);
    floatR.setAttribute('cy', yS);
    // gelembung naik di pipa saat udara tersedot / menumpuk
    const air = s.level === 'bad' || s.level === 'warn' ? 1 : 0;
    bubbles.style.display = air ? '' : 'none';
    if (air)
      [...bubbles.children].forEach((c, j) => {
        const span = H - yBot - 6;
        c.setAttribute('cy', H - (((t * 3 + j * span * 0.25) % span) + 3));
      });
  }
  return { el: root, update };
}
