/**
 * Ketuk komponen di tampilan 3D → komponen tersorot + kartu pengaturan kecil.
 *
 * Kontrol di kartu adalah "cermin" kontrol panel (slider/toggle/pilihan yang sama): mengubah
 * kartu mengirim event ke kontrol panel, jadi logika, simpan otomatis, dan log tetap satu jalur;
 * sebaliknya kartu menyalin nilai panel tiap ±0,2 dtk. Penanda titik di tiap komponen bisa
 * dimatikan (tab Tampilan).
 */
import * as THREE from 'three';
import { app, waterLitres } from '../state.js';
import { HOT_KEYS, hotBoxes, hotAnchor, pickHot } from '../render/hotspots.js';
import { rimOf, skimmerActive } from '../physics/hydraulics.js';
import { GEO } from '../physics/constants.js';
import { logEvent } from '../diag.js';
import { el, fmt, $ } from '../util/format.js';

const L = (v) => Math.round(v * 3.6) + ' L/jam';

/** Isi kartu per komponen: judul, keterangan, info langsung, dan kontrol (id kontrol panel). */
export const COMPONENTS = {
  intake: {
    title: 'Intake siphon',
    desc: 'Lubang hisap di tank: saringan bawah + mangkuk surface skimmer (atau overflow box).',
    info: ({ S, P }) => {
      const q = S.q;
      const rim = rimOf(S, P);
      const sk = skimmerActive(P, rim);
      return (
        `Debit siphon ${L(q.s)}` +
        (sk ? ` · lewat skimmer ${Math.round((100 * Math.max(0, q.k)) / Math.max(1, q.s))}% · air ${fmt(S.HT - rim, 2)} cm di atas bibir` : '') +
        (S.airIn[0] > 0 ? ' · menghisap udara!' : '')
      );
    },
    controls: ['skt', 's_zin', 's_kb', 's_zrim', 'pipe', 't_box'],
  },
  outlet: {
    title: 'U-pipe & ujung buang (output)',
    desc: 'Pipa U di atas bibir tank, ball valve, dan ujung buang di chamber kapas.',
    info: ({ S, P }) => {
      const st = [];
      for (let i = 0; i < P.n; i++) st.push(S.brk[i] ? 'putus' : 'udara ' + Math.round(S.air[i] * 100) + '%');
      const end = S.H1 > P.zd ? 'terendam ' + fmt(S.H1 - P.zd) + ' cm' : 'gantung ' + fmt(P.zd - S.H1) + ' cm';
      return `${L(S.q.s)} · ${st.join(' / ')} · ujung ${end}`;
    },
    controls: ['s_sv', 's_zd', 't_venturi', '#bBrkAll', '#bPrime'],
    tip: 'Bukaan valve yang seimbang bisa dicari otomatis di tab Analisis → Cari titik seimbang.',
  },
  nozzle: {
    title: 'Duckbill (keluaran return)',
    desc: 'Arah jet air dari filter. Pengaruhnya pada arus terlihat ±30 dtk simulasi kemudian.',
    info: ({ S }) => `Debit return ${L(Math.max(0, S.q.r))} · tinggi ujung ${fmt(GEO.ZOUT)} cm`,
    controls: ['s_nyaw', 's_npit'],
  },
  wm: {
    title: 'Wavemaker',
    desc: 'Pompa arus di kaca kanan untuk mengurangi zona mati.',
    info: ({ V, WM }) => (V.wm ? `Nyala · ${WM.q} L/jam` : 'Mati — nyalakan untuk menambah arus'),
    controls: ['t_wm', 's_wq', 's_wyaw', 's_wpit', 's_wy'],
  },
  pump: {
    title: 'Pompa return',
    desc: 'Pompa di chamber terakhir filter, dengan pelampung pemutus otomatis.',
    info: ({ S, P }) => {
      const st = !P.on ? 'mati (listrik)' : S.cutHi ? 'mati (pelampung atas)' : S.cutLo ? 'mati (pelampung bawah)' : S.HP < 2.3 ? 'jalan kering!' : 'jalan';
      return `${st} · ${L(Math.max(0, S.q.r))} · head ${fmt(S.q.hp, 0)} / statis ${fmt(S.q.hs, 0)} cm`;
    },
    controls: ['s_spd', 's_qmax', 's_hmax', 's_rv', 't_fswHi', 't_fswLo'],
  },
  floss: {
    title: 'Kapas filter',
    desc: 'Saringan mekanis di chamber pertama; makin kotor, level chamber 1 makin naik.',
    info: ({ S }) => `Ch 1 ${fmt(S.H1)} cm / Ch 2 ${fmt(S.H2)} cm (bibir 30 cm)`,
    controls: ['s_clog', { label: 'Ganti kapas baru (0%)', set: ['s_clog', 0] }],
  },
  ato: {
    title: 'ATO (isi ulang air tawar)',
    desc: 'Menambah air tawar ke chamber pompa saat level turun (penguapan).',
    info: ({ S, P }) =>
      P.ato
        ? `Terpakai ${fmt(S.ato / 1000, 2)} dari ${fmt(GEO.ATOMAX / 1000, 0)} L · chamber pompa ${fmt(S.HP)} cm (setpoint ${GEO.ATOSET})` +
          (S.ato >= GEO.ATOMAX ? ' · reservoir habis!' : '')
        : `Mati · volume air ${fmt(waterLitres())} L`,
    controls: ['t_ato'],
  },
};

/**
 * @param {{world: any}} ctx world 3D (camera, renderer, hot)
 */
export function buildInspector({ world }) {
  const view = $('view');
  const canvas = world.renderer.domElement;
  const camera = world.camera;

  /* ---------- penanda titik ---------- */
  const layer = el('div', { id: 'hotLayer' });
  view.append(layer);
  const markers = {};
  for (const k of HOT_KEYS) {
    const m = el('button', { className: 'hot', type: 'button', ariaLabel: 'Atur ' + COMPONENTS[k].title, title: COMPONENTS[k].title });
    m.addEventListener('click', (e) => {
      e.stopPropagation();
      open(k);
    });
    layer.append(m);
    markers[k] = { el: m, x: -1, y: -1, shown: null, off: null };
  }

  /* ---------- kartu ---------- */
  const card = el('div', { id: 'inspector', role: 'dialog', ariaLabel: 'Pengaturan komponen', hidden: true });
  // desktop: kartu di pojok tampilan 3D. HP/tablet (tampilan 3D menempel di atas): lembar di bawah
  // layar yang menutupi panel, bukan tank — supaya tank tetap bisa diketuk & diputar.
  const wide = window.matchMedia('(min-width: 960px)');
  const place = () => {
    const host = wide.matches ? view : document.body;
    if (card.parentElement !== host) host.append(card);
    card.classList.toggle('sheet', !wide.matches);
  };
  wide.addEventListener('change', place);
  place();
  let current = null;
  let mirrors = [];
  let infoEl = null;

  const panelLabel = (id) => {
    const lab = document.querySelector(`#controls label[for="${id}"]`);
    return (lab?.querySelector('span')?.textContent || lab?.textContent || '').trim();
  };

  /** Satu kontrol cermin untuk id kontrol panel. */
  function mirror(spec) {
    if (typeof spec === 'object') {
      const b = el('button', { className: 'insp-act', textContent: spec.label });
      b.addEventListener('click', () => {
        const [id, v] = spec.set;
        const src = $(id);
        if (!src) return;
        src.value = v;
        src.dispatchEvent(new Event('input', { bubbles: true }));
        src.dispatchEvent(new Event('change', { bubbles: true }));
      });
      return { node: b, sync() {} };
    }
    if (spec[0] === '#') {
      const src = $(spec.slice(1));
      if (!src) return null;
      const b = el('button', { className: 'insp-act', textContent: src.textContent });
      b.addEventListener('click', () => src.click());
      return { node: b, sync: () => (b.textContent = src.textContent) };
    }
    const src = $(spec);
    if (!src) return null;
    if (src.type === 'range') {
      const out = el('b');
      const inp = el('input', { type: 'range', min: src.min, max: src.max, step: src.step, value: src.value });
      const srcOut = document.querySelector(`#controls label[for="${spec}"] b`);
      let drag = false;
      inp.addEventListener('pointerdown', () => (drag = true));
      inp.addEventListener('pointerup', () => (drag = false));
      inp.addEventListener('input', () => {
        src.value = inp.value;
        src.dispatchEvent(new Event('input', { bubbles: true }));
        out.textContent = srcOut?.textContent || inp.value;
      });
      inp.addEventListener('change', () => {
        drag = false;
        src.dispatchEvent(new Event('change', { bubbles: true }));
      });
      const node = el('div', { className: 'insp-row' }, [el('label', { className: 'row' }, [el('span', { textContent: panelLabel(spec) }), out]), inp]);
      return {
        node,
        sync() {
          if (!drag && document.activeElement !== inp && inp.value !== src.value) inp.value = src.value;
          inp.disabled = src.disabled;
          node.classList.toggle('idle', src.disabled);
          const t = srcOut?.textContent || '';
          if (out.textContent !== t) out.textContent = t;
        },
      };
    }
    if (src.type === 'checkbox') {
      const c = el('input', { type: 'checkbox', checked: src.checked });
      c.addEventListener('change', () => {
        src.checked = c.checked;
        src.dispatchEvent(new Event('change', { bubbles: true }));
      });
      const text = src.closest('label')?.querySelector('span')?.textContent || spec;
      const node = el('label', { className: 'tg insp-row' }, [c, el('span', { textContent: text })]);
      return {
        node,
        sync() {
          if (c.checked !== src.checked) c.checked = src.checked;
          c.disabled = src.disabled;
        },
      };
    }
    if (src.tagName === 'SELECT') {
      const s = el('select', {}, [...src.options].map((o) => el('option', { value: o.value, textContent: o.textContent })));
      s.value = src.value;
      s.addEventListener('change', () => {
        src.value = s.value;
        src.dispatchEvent(new Event('change', { bubbles: true }));
      });
      const node = el('div', { className: 'insp-row' }, [el('label', { className: 'row', textContent: panelLabel(spec) }), s]);
      return {
        node,
        sync() {
          if (document.activeElement !== s && s.value !== src.value) s.value = src.value;
          s.disabled = src.disabled;
        },
      };
    }
    return null;
  }

  function open(key) {
    if (current === key) return;
    const def = COMPONENTS[key];
    current = key;
    const close = el('button', { className: 'insp-close', type: 'button', ariaLabel: 'Tutup', textContent: '×' });
    close.addEventListener('click', () => api.close());
    infoEl = el('div', { className: 'insp-info' });
    mirrors = def.controls.map(mirror).filter(Boolean);
    const acts = mirrors.filter((m) => m.node.classList.contains('insp-act'));
    const rows = mirrors.filter((m) => !m.node.classList.contains('insp-act'));
    const parts = [
      el('div', { className: 'insp-head' }, [el('b', { textContent: def.title }), close]),
      el('p', { className: 'insp-desc', textContent: def.desc }),
      infoEl,
      ...rows.map((m) => m.node),
      acts.length ? el('div', { className: 'btns' }, acts.map((m) => m.node)) : null,
      def.tip ? el('p', { className: 'insp-desc', textContent: def.tip }) : null,
    ];
    card.replaceChildren(...parts.filter(Boolean)); // null → teks "null" bila tidak disaring
    card.hidden = false;
    card.scrollTop = 0;
    sync();
    logEvent('klik', 'Komponen 3D: ' + def.title);
  }

  function sync() {
    if (!current) return;
    for (const m of mirrors) m.sync();
    const t = COMPONENTS[current].info(app);
    if (infoEl.textContent !== t) infoEl.textContent = t;
  }

  /* ---------- ketuk di kanvas (bukan seret/putar, bukan cubit) ---------- */
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const down = new Map();
  let multi = false;
  canvas.addEventListener('pointerdown', (e) => {
    down.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now() });
    if (down.size > 1) multi = true;
  });
  const up = (e) => {
    const d = down.get(e.pointerId);
    down.delete(e.pointerId);
    if (!d) return;
    const tap = !multi && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 7 && performance.now() - d.t < 450;
    if (down.size === 0) multi = false;
    if (!tap || e.type === 'pointercancel') return;
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const k = pickHot(app, ray.ray);
    if (k) open(k);
    else api.close();
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  document.addEventListener('keydown', (e) => e.key === 'Escape' && api.close());

  /* ---------- per frame: penanda + sorotan ---------- */
  const v = new THREE.Vector3();
  let t = 0;
  const api = {
    close() {
      if (!current) return;
      current = null;
      mirrors = [];
      card.hidden = true;
      card.replaceChildren();
      world.hot.set(null);
    },
    open,
    get current() {
      return current;
    },
    frame(dt) {
      t += dt;
      world.hot.set(current ? hotBoxes(app)[current] : null);
      world.hot.tick(t);
      const show = app.V.hot !== false;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      for (const k of HOT_KEYS) {
        const m = markers[k];
        let vis = show && k !== current;
        if (vis) {
          const a = hotAnchor(app, k);
          v.set(a[0], a[1], a[2]).project(camera);
          vis = v.z > -1 && v.z < 1 && Math.abs(v.x) < 1.02 && Math.abs(v.y) < 1.02;
          if (vis) {
            const x = Math.round(((v.x + 1) / 2) * w);
            const y = Math.round(((1 - v.y) / 2) * h);
            if (x !== m.x || y !== m.y) {
              m.x = x;
              m.y = y;
              m.el.style.transform = `translate(${x}px, ${y}px)`;
            }
          }
        }
        if (m.shown !== vis) {
          m.shown = vis;
          m.el.hidden = !vis;
        }
        // komponen yang sedang mati (wavemaker, ATO): penanda "+" untuk menyalakan
        const off = (k === 'wm' && !app.V.wm) || (k === 'ato' && !app.P.ato);
        if (m.off !== off) {
          m.off = off;
          m.el.classList.toggle('hot-off', off); // bukan 'off': bentrok dengan gaya tombol listrik
        }
      }
    },
    /** Tiap ±0,2 dtk: salin nilai panel ke kartu. */
    update() {
      sync();
    },
  };
  return api;
}
