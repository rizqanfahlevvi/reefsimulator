/**
 * Titik masuk halaman Desain 2 (tank 60×40×40 + overflow bersisir eksternal, lubang bor, Bean Animal).
 * Sump menyusul. Semua angka dari model murni ./model.js; 3D dirender hanya saat perlu.
 */
import '../styles.css';
import './d2.css';
import * as M from './model.js';
import { buildPanel } from './panel.js';

const KEY = 'reefsim:desain2';
const view = document.getElementById('view');
const status = document.getElementById('status');

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (raw && typeof raw === 'object') return { p: M.sanitizeD2(raw.p || {}), auto: raw.auto !== false };
  } catch {
    /* penyimpanan rusak/terblokir → bawaan */
  }
  return { p: M.defaultD2(), auto: true };
}
const st = load();
let saveT = 0;
const save = () => {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ v: 1, p: st.p, auto: st.auto }));
    } catch {
      /* mode privat */
    }
  }, 300);
};

let scene = null;
const panel = buildPanel(document.getElementById('panel'), {
  onChange(patch, opt = {}) {
    if (opt.auto !== undefined) st.auto = opt.auto;
    st.p = M.sanitizeD2({ ...st.p, ...patch });
    schedule();
  },
  onReset() {
    st.p = { ...M.defaultD2(), Q: st.p.Q };
    st.auto = true;
    schedule();
  },
});

let raf = 0;
function schedule() {
  if (!raf) raf = requestAnimationFrame(recompute);
}
function recompute() {
  raf = 0;
  if (st.auto) st.p.gate = M.autoGate(st.p, st.p.Q);
  const s = M.solve(st.p);
  panel.render(st.p, s, st);
  if (scene) scene.update(st.p, s);
  status.textContent = !s.ok ? 'Meluap pada debit ini' : s.flags.length ? `${s.flags.length} hal perlu disetel` : `Aman · tank ${s.hTank.toFixed(1).replace('.', ',')} cm`;
  status.dataset.level = !s.ok ? 'bad' : s.flags.length ? 'warn' : 'ok';
  save();
}

// 3D dimuat terpisah supaya kalkulator tetap jalan walau WebGL tidak ada
import('./scene.js')
  .then(({ createD2Scene }) => {
    scene = createD2Scene(view);
    const btns = document.getElementById('vbtn');
    const mark = (v) => {
      for (const b of btns.querySelectorAll('[data-v]')) b.classList.toggle('sel', b.dataset.v === v);
    };
    btns.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.v) {
        scene.setView(b.dataset.v);
        mark(b.dataset.v);
        cutBtn.classList.toggle('sel', scene.cut);
      }
    });
    const cutBtn = document.getElementById('bCut');
    cutBtn.addEventListener('click', () => {
      scene.setCut(!scene.cut);
      cutBtn.classList.toggle('sel', scene.cut);
    });
    const lblBtn = document.getElementById('bLbl');
    let lbl = true;
    lblBtn.addEventListener('click', () => {
      lbl = !lbl;
      scene.setLabels(lbl);
      lblBtn.classList.toggle('sel', lbl);
    });
    lblBtn.classList.add('sel');
    mark('iso');
    schedule();
  })
  .catch((err) => {
    console.error(err);
    document.getElementById('glError').hidden = false;
  });

schedule();
