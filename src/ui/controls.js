/** Panel kontrol: slider, toggle, pilihan pipa/skimmer/kualitas/tampilan, tombol cepat. */
import { app, emit, waterLitres, salinity, resetState } from '../state.js';
import { defaultParams, initialState } from '../physics/hydraulics.js';
import { fmt, $, el } from '../util/format.js';

const GROUPS = ['Air', 'Pompa return', 'Siphon U-pipe', 'Arus di tank', 'Filter dan pengaman', 'Ornamen', 'Tampilan dan simulasi', 'Skimmer, latar, dan lampu'];
const OPEN_GROUPS = new Set([0, 1, 2, 3, 7]);

/**
 * @param {object} h hooks: rebuildSiphon, applyView, applyGlass, applyBg, setQuality, setAutoQuality, resetFlow, updElec
 */
export function buildControls(h) {
  const S = () => app.S;
  const P = () => app.P;
  const markSiphon = () => emit('siphon-dirty');

  const SL = [
    {
      g: 0, id: 'vol', label: 'Volume air yang diisi', min: 28, max: 44, step: 0.1, d: 1, unit: ' L',
      get: () => app.volS,
      set: (v) => {
        S().pend += (v - app.volS) * 1000;
        app.volS = v;
      },
    },
    {
      g: 0, id: 'disp', label: 'Batu dan pasir (menggantikan air)', min: 0, max: 10, step: 0.5, d: 1, unit: ' L',
      get: () => P().disp,
      set: (v) => {
        const c = salinity();
        const d = v - P().disp;
        P().disp = v;
        app.volS -= d;
        S().salt = c * waterLitres();
        const u = U.vol;
        u.inp.value = app.volS;
        u.out.textContent = fmt(app.volS, 1) + ' L';
      },
    },
    { g: 1, id: 'spd', label: 'Daya pompa', min: 30, max: 100, step: 1, d: 0, unit: '%', get: () => P().spd * 100, set: (v) => (P().spd = v / 100) },
    { g: 1, id: 'qmax', label: 'Debit maks pompa (F-max)', min: 200, max: 1500, step: 50, d: 0, unit: ' L/jam', get: () => P().qmax, set: (v) => (P().qmax = v) },
    { g: 1, id: 'hmax', label: 'Tinggi angkat maks (H-max)', min: 0.3, max: 2, step: 0.1, d: 1, unit: ' m', get: () => P().hmax, set: (v) => (P().hmax = v) },
    { g: 1, id: 'rv', label: 'Ball valve return', min: 5, max: 100, step: 1, d: 0, unit: '%', get: () => P().rv * 100, set: (v) => (P().rv = v / 100) },
    { g: 2, id: 'zd', label: 'Tinggi ujung buang siphon', min: 18, max: 27, step: 0.1, d: 1, unit: ' cm', get: () => P().zd, set: (v) => { P().zd = v; markSiphon(); } },
    { g: 2, id: 'zin', label: 'Tinggi intake bawah dari dasar', min: 2, max: 22, step: 0.5, d: 1, unit: ' cm', get: () => P().zin, set: (v) => { P().zin = v; markSiphon(); } },
    { g: 2, id: 'kb', label: 'Bukaan intake bawah', min: 5, max: 100, step: 1, d: 0, unit: '%', get: () => P().kb * 100, set: (v) => (P().kb = v / 100) },
    { g: 2, id: 'zrim', label: 'Tinggi bibir surface skimmer (tipe tetap)', min: 22, max: 29.5, step: 0.1, d: 1, unit: ' cm', get: () => P().zrim, set: (v) => { P().zrim = v; markSiphon(); } },
    { g: 2, id: 'sv', label: 'Ball valve U-pipe', min: 5, max: 100, step: 1, d: 0, unit: '%', get: () => P().sv * 100, set: (v) => (P().sv = v / 100) },
    { g: 4, id: 'clog', label: 'Kapas kotor', min: 0, max: 95, step: 1, d: 0, unit: '%', get: () => P().clog * 100, set: (v) => (P().clog = v / 100) },
    { g: 3, id: 'nyaw', label: 'Duckbill mendatar (0° lurus ke kiri, + ke depan)', min: -90, max: 90, step: 5, d: 0, unit: '°', get: () => app.NZL.yaw, set: (v) => (app.NZL.yaw = v) },
    { g: 3, id: 'npit', label: 'Duckbill naik/turun (+ ke atas)', min: -60, max: 45, step: 5, d: 0, unit: '°', get: () => app.NZL.pitch, set: (v) => (app.NZL.pitch = v) },
    { g: 3, id: 'sliceY', label: 'Tinggi irisan peta kecepatan', min: 2, max: 28, step: 1, d: 0, unit: ' cm', get: () => app.sliceY, set: (v) => (app.sliceY = v) },
    { g: 3, id: 'wq', label: 'Debit wavemaker', min: 300, max: 3000, step: 100, d: 0, unit: ' L/jam', get: () => app.WM.q, set: (v) => (app.WM.q = v) },
    { g: 3, id: 'wyaw', label: 'Wavemaker mendatar (+ ke depan)', min: -80, max: 80, step: 5, d: 0, unit: '°', get: () => app.WM.yaw, set: (v) => (app.WM.yaw = v) },
    { g: 3, id: 'wpit', label: 'Wavemaker naik/turun (+ ke atas)', min: -45, max: 45, step: 5, d: 0, unit: '°', get: () => app.WM.pitch, set: (v) => (app.WM.pitch = v) },
    { g: 3, id: 'wy', label: 'Tinggi wavemaker', min: 5, max: 25, step: 1, d: 0, unit: ' cm', get: () => app.WM.y, set: (v) => (app.WM.y = v) },
    { g: 6, id: 'tint', label: 'Kepekatan warna kaca', min: 0, max: 100, step: 5, d: 0, unit: '%', get: () => app.glassTint * 100, set: (v) => { app.glassTint = v / 100; h.applyGlass(); } },
    { g: 7, id: 'li', label: 'Kecerahan lampu', min: 10, max: 100, step: 5, d: 0, unit: '%', get: () => app.LOOK.li, set: (v) => (app.LOOK.li = v) },
    { g: 6, id: 'sp', label: 'Kecepatan simulasi', min: 1, max: 20, step: 1, d: 0, unit: '×', get: () => app.SPD, set: (v) => (app.SPD = v) },
  ];
  const TG = [
    { g: 2, id: 'venturi', label: 'Selang udara ke venturi / aqualifter' },
    { g: 2, id: 'box', label: 'Overflow box (sisir 26,5 cm) sebagai surface skimmer' },
    { g: 3, id: 'cfd', view: true, label: 'Simulasi arus di tank dan filter (jejak berwarna)' },
    { g: 3, id: 'sliceOn', view: true, label: 'Peta kecepatan (irisan mendatar)' },
    { g: 3, id: 'wm', view: true, label: 'Wavemaker di kaca kanan' },
    { g: 4, id: 'hole', label: 'Lubang siphon-break di return (26,3 cm)' },
    { g: 1, id: 'fswHi', label: 'Auto-off pompa: pelampung atas di tank (mati di 28,5 cm, cegah banjir)' },
    { g: 1, id: 'fswLo', label: 'Auto-off pompa: pelampung bawah di chamber pompa (mati di 4 cm, cegah pompa kering)' },
    { g: 4, id: 'ato', label: 'ATO aktif (setpoint 18 cm, reservoir 2 L)' },
    { g: 5, id: 'fish', view: true, label: 'Ikan' },
    { g: 5, id: 'coral', view: true, label: 'Karang' },
    { g: 5, id: 'rock', view: true, label: 'Batu hidup (ikut menghalangi arus)' },
    { g: 5, id: 'sand', view: true, label: 'Pasir' },
    { g: 5, id: 'lamp', view: true, label: 'Lampu LED' },
    { g: 5, id: 'room', view: true, label: 'Lemari dan ruangan' },
    { g: 6, id: 'flow', view: true, label: 'Penanda aliran di pipa dan filter' },
    { g: 6, id: 'clear', view: true, label: 'Pipa bening (lihat air dan udara di dalam)' },
    { g: 6, id: 'label', view: true, label: 'Label nama' },
  ];

  const U = {};
  const root = $('controls');
  const gs = GROUPS.map((t, i) => {
    const d = el('details', { open: OPEN_GROUPS.has(i) }, [el('summary', { textContent: t })]);
    root.append(d);
    return d;
  });

  const selectRow = (parent, label, id, opts, onChange, before = null) => {
    const l = el('label', { className: 'row', htmlFor: id, textContent: label });
    const k = el('select', { id, style: 'width:100%' }, opts.map(([v, t]) => el('option', { value: v, textContent: t })));
    k.addEventListener('change', () => onChange(k.value));
    parent.insertBefore(l, before);
    parent.insertBefore(k, before);
    return k;
  };

  for (const s of SL) {
    const out = el('b');
    const l = el('label', { className: 'row', htmlFor: 's_' + s.id }, [el('span', { textContent: s.label }), out]);
    const inp = el('input', { type: 'range', id: 's_' + s.id, min: s.min, max: s.max, step: s.step });
    gs[s.g].append(l, inp);
    U[s.id] = { inp, out, def: s };
    inp.addEventListener('input', () => {
      s.set(+inp.value);
      out.textContent = fmt(+inp.value, s.d) + s.unit;
    });
  }

  selectRow(gs[2], 'Ukuran U-pipe (1 pipa)', 'pipe', [
    ['1|1.8', 'PVC ½" × 1 (dalam 18 mm)'],
    ['1|2.2', 'PVC ¾" × 1 (dalam 22 mm)'],
    ['1|1.7', 'TY 20 mm × 1 (dalam 17 mm)'],
  ], (val) => {
    const [n, D] = val.split('|');
    const p = P();
    p.n = +n;
    p.D = +D;
    p.sv = p.box ? 1 : p.n === 2 ? 0.3 : defaultParams().sv;
    for (let i = p.n; i < 2; i++) {
      S().brk[i] = false;
      S().air[i] = 0;
      S().vs[i] = 0;
    }
    h.rebuildSiphon();
    syncUI();
  });
  selectRow(gs[2], 'Surface skimmer di intake', 'skt', [
    ['1', 'Mangkuk bercelah, tinggi tetap (PVC)'],
    ['2', 'Kepala mengapung (model kaca)'],
    ['0', 'Tanpa surface skimmer'],
  ], (val) => {
    P().sk = +val;
    h.rebuildSiphon();
    syncUI();
  });
  selectRow(gs[6], 'Kualitas grafis', 'qual', [
    ['a', 'Otomatis (menyesuaikan perangkat)'],
    ['0', 'Tinggi'],
    ['2', 'Sedang'],
    ['3', 'Hemat'],
  ], (val) => {
    if (val === 'a') h.setAutoQuality(true);
    else {
      h.setAutoQuality(false);
      h.setQuality(+val);
    }
  });

  for (const t of TG) {
    const c = el('input', { type: 'checkbox', id: 't_' + t.id });
    gs[t.g].append(el('label', { className: 'tg' }, [c, el('span', { textContent: t.label })]));
    U[t.id] = { chk: c };
    c.addEventListener('change', () => {
      if (t.view) {
        app.V[t.id] = c.checked;
        if (t.id === 'clear') h.rebuildSiphon();
        applyView();
        return;
      }
      const p = P();
      p[t.id] = c.checked;
      if (t.id === 'box') {
        h.resetFlow();
        if (c.checked) {
          p.sv = 1;
          p.zd = 21.5;
        } else {
          const d = defaultParams();
          p.sv = p.n === 1 ? d.sv : 0.25;
          p.zd = d.zd;
        }
        app.S = initialState(p);
        app.hist.length = 0;
        app.volS = waterLitres();
        syncUI();
      }
      h.rebuildSiphon();
    });
  }

  /* arus: legenda warna, catatan, preset tampilan */
  gs[3].append(
    el('div', {
      className: 'lg',
      innerHTML:
        '<span><i style="background:#ed2e33"></i>&lt;1 cm/s (zona mati)</span><span><i style="background:#ffd633"></i>1–3 lemah</span><span><i style="background:#2ee69e"></i>3–8 sedang</span><span><i style="background:#e6faff;border:1px solid #9bb"></i>&gt;8 kuat</span>',
    }),
    el('p', {
      className: 'note',
      style: 'margin-top:6px',
      textContent:
        'Pola arus butuh ±30 detik simulasi untuk stabil setelah arah diubah. Model kisi 1,5 cm ini untuk membandingkan arah nozzle, bukan angka mutlak.',
    }),
  );
  {
    const b = el('div', { className: 'btns' });
    const mk = (text, fn) => {
      const e = el('button', { textContent: text });
      e.addEventListener('click', fn);
      b.append(e);
    };
    mk('Mode studi aliran', () => {
      Object.assign(app.V, { fish: false, coral: false, lamp: false, room: false, label: false, cfd: true, sliceOn: true, flow: true });
      applyView();
      syncUI();
    });
    mk('Mode rencana lengkap', () => {
      Object.assign(app.V, { fish: true, coral: true, rock: true, sand: true, lamp: true, room: true, label: true, cfd: true, sliceOn: false });
      applyView();
      syncUI();
    });
    gs[5].append(b);
  }

  /* skimmer, latar, lampu — disisipkan sebelum slider kecerahan */
  {
    const g7 = gs[7];
    const first = g7.querySelector('label.row');
    const dark = el('input', { type: 'checkbox', id: 't_dark' });
    g7.insertBefore(el('label', { className: 'tg' }, [dark, el('span', { textContent: 'Lampu ruangan mati (mode gelap)' })]), first);
    dark.addEventListener('change', () => {
      app.LOOK.dark = dark.checked;
      if (dark.checked && app.LOOK.lamp === 'off') {
        app.LOOK.lamp = 'mix';
        $('lampsel').value = 'mix';
      }
    });
    selectRow(g7, 'Tipe protein skimmer', 'sktype', [
      ['air', 'Aerator (batu kayu + pompa udara)'],
      ['ven', 'Pompa venturi (needle-wheel)'],
    ], (v) => {
      app.LOOK.skim = v;
      h.updElec();
    }, first).value = app.LOOK.skim;
    const cp = el('input', { type: 'color', value: app.LOOK.bgc, style: 'display:none', ariaLabel: 'Warna latar' });
    selectRow(g7, 'Latar belakang tank', 'bgsel', [
      ['black', 'Hitam doff'],
      ['white', 'Putih doff'],
      ['gwhite', 'Putih glossy'],
      ['marine', 'Biru marine'],
      ['custom', 'Warna sendiri'],
      ['none', 'Tanpa latar (kaca bening)'],
    ], (v) => {
      app.LOOK.bg = v;
      cp.style.display = v === 'custom' ? '' : 'none';
      h.applyBg();
    }, first).value = app.LOOK.bg;
    g7.insertBefore(cp, first);
    cp.addEventListener('input', () => {
      app.LOOK.bgc = cp.value;
      h.applyBg();
    });
    selectRow(g7, 'Warna lampu', 'lampsel', [
      ['white', 'Putih terang (±10.000 K)'],
      ['cool', 'Putih kebiruan (±14.000 K)'],
      ['mix', 'Mix putih + biru (umum reef)'],
      ['blue', 'Marine blue / actinic'],
      ['purple', 'Biru-ungu (full spectrum)'],
      ['off', 'Lampu mati'],
    ], (v) => (app.LOOK.lamp = v), first).value = app.LOOK.lamp;
  }

  function applyView() {
    h.applyView();
    const { V } = app;
    for (const k of ['wq', 'wyaw', 'wpit', 'wy']) U[k].inp.disabled = !V.wm;
    U.sliceY.inp.disabled = !V.sliceOn;
    for (const k of ['nyaw', 'npit']) U[k].inp.disabled = !V.cfd;
  }

  function syncUI() {
    for (const s of SL) {
      const u = U[s.id];
      const v = s.get();
      u.inp.value = v;
      u.out.textContent = fmt(v, s.d) + s.unit;
    }
    for (const t of TG) U[t.id].chk.checked = !!(t.view ? app.V[t.id] : app.P[t.id]);
    const p = P();
    $('pipe').value = p.n + '|' + p.D;
    $('skt').value = String(p.sk);
    $('skt').disabled = p.box;
    U.zin.inp.disabled = p.box;
    U.kb.inp.disabled = p.box;
    U.zrim.inp.disabled = p.box || p.sk !== 1;
    const b = $('bPow');
    b.textContent = p.on ? 'Listrik: nyala' : 'Listrik: mati';
    b.className = p.on ? 'on' : 'off';
    $('lgBox').style.display = p.box ? '' : 'none';
    $('bBrkAll').textContent = p.n === 2 ? 'Putuskan semua' : 'Putuskan siphon';
  }

  /* tombol cepat */
  $('bPow').addEventListener('click', () => {
    P().on = !P().on;
    app.tOn = 0;
    syncUI();
  });
  $('bOut').addEventListener('click', () => {
    P().on = false;
    app.tOn = S().t + 60;
    syncUI();
  });
  $('bBrkAll').addEventListener('click', () => {
    for (let i = 0; i < P().n; i++) {
      S().brk[i] = true;
      S().air[i] = 1;
      S().vs[i] = 0;
    }
  });
  $('bPrime').addEventListener('click', () => {
    for (let i = 0; i < P().n; i++) {
      S().brk[i] = false;
      S().air[i] = 0;
    }
  });
  $('bPause').addEventListener('click', () => {
    app.paused = !app.paused;
    $('bPause').textContent = app.paused ? 'Lanjut' : 'Jeda';
  });
  $('bReset').addEventListener('click', () => {
    h.resetFlow();
    resetState();
    app.tOn = 0;
    app.SPD = 3;
    app.paused = false;
    $('bPause').textContent = 'Jeda';
    h.rebuildSiphon();
    syncUI();
  });

  return { syncUI, applyView, U };
}
