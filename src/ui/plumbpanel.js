/**
 * Panel mode "Rakit pipa": mulai rangkaian (atau templat), katalog bagian yang cocok dengan ujung
 * terpilih, properti bagian, undo/redo, daftar bahan, simpan/muat/ekspor desain; fase 2: alat
 * ukur & cek tabrakan; fase 3: hidrolik jalur return + "pakai sebagai pipa return di simulasi".
 * Semua perubahan lewat model murni (plumb/model.js) lalu editor 3D dibangun ulang.
 */
import { SIZES, SIZE_ORDER, COLORS, TYPES, CATS, END_LABEL, classFor } from '../plumb/catalog.js';
import {
  newDesign,
  addRoot,
  addPart,
  removePart,
  updatePart,
  insertInline,
  altCports,
  candidates,
  partPorts,
  cloneDesign,
  validateDesign,
  dirLabel,
  DIR_LABEL,
  INLINE,
  LEN,
} from '../plumb/model.js';
import { bom, bomMarkdown, partName } from '../plumb/bom.js';
import { loadStore, saveStore } from '../plumb/store.js';
import { analyzeLine, operatingPoints, applyRetLine, EXITS, V_HIGH } from '../plumb/hydro.js';
import { collisions } from '../plumb/collide.js';
import { TEMPLATES, templateLabel, buildTemplate } from '../plumb/templates.js';
import { app } from '../state.js';
import { logEvent } from '../diag.js';
import { el, fmt } from '../util/format.js';
import { toast } from './toast.js';

const cm = (mm) => fmt(mm / 10, 1);
const endKey = (e) => (e ? e.pid + ':' + e.port : '');
const parseEnd = (k) => {
  const [pid, port] = String(k).split(':').map(Number);
  return Number.isInteger(pid) && Number.isInteger(port) ? { pid, port } : null;
};

/** Preset titik awal (cm) di sekitar tank. */
const PRESETS = [
  { label: 'Keluaran pompa return', p: [44.5, 6.2, -7.5], dir: 'up' },
  { label: 'Di atas bibir tank', p: [25, 33, 12.5], dir: 'down' },
  { label: 'Lantai depan (bebas)', p: [25, 0, 35], dir: 'up' },
];

const PORT_NAMES = {
  tee: ['ujung lurus 1', 'ujung lurus 2', 'cabang'],
  teeR: ['ujung lurus 1', 'ujung lurus 2', 'cabang (kecil)'],
  teeF: ['ujung lurus 1', 'ujung lurus 2', 'cabang drat'],
  cross: ['ujung 1', 'ujung 2', 'cabang kanan', 'cabang kiri'],
};
const portName = (type, i) => PORT_NAMES[type]?.[i] || `ujung ${i + 1}`;

/**
 * @param {HTMLElement} root wadah panel
 * @param {{editor: any, onExit: () => void}} ctx
 */
export function buildPlumbPanel(root, { editor, onExit }) {
  const store = loadStore();
  let design = store.cur || newDesign();
  let saved = store.saved;
  const sim = store.sim; // pilihan hidrolik: {on, inlet, outlet, exit}
  let hyd = null; // hasil analyzeLine terakhir
  let col = { hits: [], parts: new Set() };
  let showSpeed = false;
  const meas = { on: false, pts: [] };
  const undo = [];
  const redo = [];
  let sel = { part: null, port: null };
  let showStart = !design.parts.length;
  let refVisible = true;
  // bawaan untuk bagian baru
  const prefs = { series: 'in', cls: 'AW', size: 'i34', color: 'abu', len: 200, stick: 4000 };

  const persist = () => saveStore({ cur: design, saved, sim });

  /** Ubah desain dengan undo; error (mis. sambungan tidak cocok) → pesan, desain tidak berubah. */
  function mutate(fn, okMsg) {
    const before = cloneDesign(design);
    try {
      const r = fn();
      undo.push(before);
      if (undo.length > 60) undo.shift();
      redo.length = 0;
      commit();
      if (okMsg) toast(okMsg);
      return r;
    } catch (err) {
      design = before;
      toast(err.message || String(err));
      return undefined;
    }
  }
  function commit() {
    editor.rebuild(design);
    editor.select(sel.part, sel.port);
    analyze();
    persist();
    render();
  }

  /** Cek tabrakan + hidrolik setelah desain berubah; jalur simulasi ikut diperbarui. */
  function analyze() {
    col = collisions(design, editor.frames);
    editor.setCollisions(col.parts);
    hyd = design.parts.length ? analyzeLine(design, sim) : null;
    if (hyd?.ok) {
      sim.inlet = hyd.inlet;
      sim.outlet = hyd.outlet;
    }
    editor.setRoles(hyd?.ok ? { inlet: hyd.inlet, outlet: hyd.outlet } : null);
    if (sim.on && !hyd?.ok) {
      sim.on = false;
      toast('Desain tidak lagi punya jalur pompa → ujung keluar yang valid; simulasi kembali memakai pipa return bawaan');
      logEvent('ubah', 'Rakit pipa: pipa return simulasi kembali ke bawaan (jalur desain tidak valid)');
    }
    const want = sim.on && hyd?.ok ? hyd.line : null;
    if (want || app.P.retLine) applyRetLine(app.P, app.S, want);
  }

  /* ---------- kerangka panel ---------- */
  const head = el('div', { className: 'card' });
  const back = el('button', { className: 'pl-back', textContent: '← Kembali ke simulasi' });
  back.addEventListener('click', onExit);
  const bUndo = el('button', { textContent: '↶ Urungkan' });
  const bRedo = el('button', { textContent: '↷ Ulangi' });
  bUndo.addEventListener('click', () => {
    if (!undo.length) return;
    redo.push(cloneDesign(design));
    design = undo.pop();
    sel = { part: null, port: null };
    commit();
  });
  bRedo.addEventListener('click', () => {
    if (!redo.length) return;
    undo.push(cloneDesign(design));
    design = redo.pop();
    sel = { part: null, port: null };
    commit();
  });
  const bFocus = el('button', { textContent: 'Fokus ke rakitan' });
  bFocus.addEventListener('click', () => editor.focus());
  const refChk = el('input', { type: 'checkbox', checked: true, id: 'plRef' });
  refChk.addEventListener('change', () => {
    refVisible = refChk.checked;
    editor.setReference(refVisible);
  });
  const nameIn = el('input', { type: 'text', className: 'pl-name', value: design.name, maxLength: 60, ariaLabel: 'Nama desain' });
  nameIn.addEventListener('change', () => {
    design.name = nameIn.value.trim().slice(0, 60) || 'Desain pipa';
    persist();
  });
  const bNew = el('button', { textContent: 'Desain baru' });
  bNew.addEventListener('click', () => {
    if (design.parts.length && !window.confirm('Mulai desain baru? Desain sekarang tetap bisa dipulihkan dengan Urungkan.')) return;
    undo.push(cloneDesign(design));
    design = newDesign();
    sel = { part: null, port: null };
    showStart = true;
    commit();
  });
  const bSave = el('button', { textContent: 'Simpan' });
  bSave.addEventListener('click', () => {
    saved[design.name] = cloneDesign(design);
    persist();
    renderLoad();
    toast(`Desain "${design.name}" disimpan di browser ini`);
  });
  const loadSel = el('select', { ariaLabel: 'Muat desain tersimpan' });
  loadSel.addEventListener('change', () => {
    const d = saved[loadSel.value];
    loadSel.value = '';
    if (!d) return;
    undo.push(cloneDesign(design));
    design = cloneDesign(d);
    sel = { part: null, port: null };
    showStart = !design.parts.length;
    commit();
    editor.focus();
  });
  const bExport = el('button', { textContent: 'Ekspor .json' });
  bExport.addEventListener('click', () => download(`${design.name || 'desain-pipa'}.json`, JSON.stringify(design, null, 1), 'application/json'));
  const fileIn = el('input', { type: 'file', accept: '.json,application/json', hidden: true });
  const bImport = el('button', { textContent: 'Impor' });
  bImport.addEventListener('click', () => fileIn.click());
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files?.[0];
    fileIn.value = '';
    if (!f) return;
    try {
      const { design: d, dropped } = validateDesign(JSON.parse(await f.text()));
      undo.push(cloneDesign(design));
      design = d;
      sel = { part: null, port: null };
      showStart = !design.parts.length;
      commit();
      editor.focus();
      toast(dropped ? `Diimpor; ${dropped} bagian tidak valid dibuang` : 'Desain diimpor');
    } catch {
      toast('Berkas tidak bisa dibaca sebagai desain pipa');
    }
  });
  head.append(
    el('div', { className: 'pl-head' }, [el('b', { textContent: 'Rakit pipa' }), back]),
    el('div', { className: 'btns' }, [bUndo, bRedo, bFocus, el('label', { className: 'tg pl-ref' }, [refChk, el('span', { textContent: 'Tank acuan' })])]),
    el('div', { className: 'pl-file' }, [nameIn, el('div', { className: 'btns' }, [bNew, bSave, loadSel, bExport, bImport, fileIn])]),
  );

  const ctxCard = el('div', { className: 'card pl-ctx' });
  const toolCard = el('div', { className: 'card' });
  const hydCard = el('div', { className: 'card' });
  const hydLive = el('p', { className: 'note pl-live' });
  const bomBox = el('div');
  const bomCard = el('div', { className: 'card' }, [el('details', { open: true }, [el('summary', { textContent: 'Daftar bahan' }), bomBox])]);
  const note = el('p', {
    className: 'note',
    textContent:
      'Dimensi seri Indonesia (diameter luar, tebal AW/D, kedalaman sok, panjang badan fitting) adalah perkiraan dan beda antar merek; sok metrik mengikuti ISO 727 dan drat mengikuti BSP (ISO 7-1). Material hanya uPVC — fitting besi/kuningan tidak disediakan karena berkarat dan beracun di air laut.',
  });
  root.append(head, ctxCard, toolCard, hydCard, bomCard, note);

  function renderLoad() {
    const names = Object.keys(saved);
    loadSel.replaceChildren(el('option', { value: '', textContent: names.length ? 'Muat desain…' : 'Belum ada desain tersimpan' }), ...names.map((n) => el('option', { value: n, textContent: n })));
    loadSel.disabled = !names.length;
  }

  /* ---------- konteks: mulai / ujung terpilih / bagian terpilih ---------- */
  const field = (label, input) => el('label', { className: 'pl-field' }, [el('span', { textContent: label }), input]);
  const select = (opts, value, on) => {
    const s = el('select', {}, opts.map(([v, t]) => el('option', { value: v, textContent: t })));
    s.value = value;
    s.addEventListener('change', () => on(s.value));
    return s;
  };
  const num = (value, step, on, min, max) => {
    const i = el('input', { type: 'number', value, step, min, max, inputMode: 'decimal', className: 'pl-num' });
    i.addEventListener('change', () => {
      const v = parseFloat(i.value);
      if (Number.isFinite(v)) on(v);
    });
    return i;
  };
  const sizeOpts = () => SIZE_ORDER[prefs.series].map((k) => [k, SIZES[k].label]);
  const seriesVal = () => (prefs.series === 'm' ? 'm' : 'in-' + prefs.cls);

  function renderStart() {
    const anchor = { p: [44.5, 6.2, -7.5], dir: 'up', ...(renderStart.last || {}) };
    renderStart.last = anchor;
    const seriesSel = select(
      [
        ['in-AW', 'Indonesia · AW (10 kg/cm²)'],
        ['in-D', 'Indonesia · D (5 kg/cm²)'],
        ['m', 'Metrik · PN16'],
      ],
      seriesVal(),
      (v) => {
        prefs.series = v === 'm' ? 'm' : 'in';
        prefs.cls = v === 'in-D' ? 'D' : 'AW';
        if (SIZES[prefs.size].series !== prefs.series) prefs.size = SIZE_ORDER[prefs.series][1];
        render();
      },
    );
    const sizeSel = select(sizeOpts(), prefs.size, (v) => (prefs.size = v));
    const colorSel = select(Object.entries(COLORS).map(([k, c]) => [k, c.label]), prefs.color, (v) => (prefs.color = v));
    const xs = anchor.p.map((v, i) => num(v, 0.5, (x) => (anchor.p[i] = x)));
    const dirSel = select(Object.entries(DIR_LABEL), anchor.dir, (v) => (anchor.dir = v));
    const presets = el(
      'div',
      { className: 'btns' },
      PRESETS.map((pr) => {
        const b = el('button', { textContent: pr.label });
        b.addEventListener('click', () => {
          anchor.p = [...pr.p];
          anchor.dir = pr.dir;
          renderStart.last = anchor;
          render();
        });
        return b;
      }),
    );
    const lenIn = num(prefs.len / 10, 0.5, (v) => (prefs.len = v * 10), 2, 400);
    const start = (type) =>
      mutate(() => {
        const id = addRoot(design, {
          type,
          size: prefs.size,
          sizeB: TYPES[type].two ? SIZE_ORDER[prefs.series][0] : undefined,
          cls: prefs.cls,
          color: prefs.color,
          len: prefs.len,
          anchor: { p: anchor.p.map((v) => v * 10), dir: anchor.dir },
        });
        showStart = false;
        autoNext(id);
        logEvent('ubah', `Rakit pipa: mulai ${TYPES[type].name} ${SIZES[prefs.size].label}`);
      });
    const bPipe = el('button', { className: 'pl-primary', textContent: 'Mulai dengan pipa' });
    bPipe.addEventListener('click', () => start('pipe'));
    const typeSel = select(
      Object.entries(TYPES)
        .filter(([k, t]) => k !== 'pipe' && !t.two)
        .map(([k, t]) => [k, t.name]),
      'ballvalve',
      () => {},
    );
    const bFit = el('button', { textContent: 'Mulai dengan fitting' });
    bFit.addEventListener('click', () => start(typeSel.value));
    const tpl = el(
      'div',
      { className: 'btns' },
      TEMPLATES.map((t) => {
        const label = templateLabel(t, prefs.series);
        const b = el('button', { textContent: label });
        b.addEventListener('click', () => {
          mutate(() => {
            const id = buildTemplate(design, t, { series: prefs.series, cls: prefs.cls });
            showStart = false;
            sel = { part: id, port: null };
            logEvent('ubah', 'Rakit pipa: templat ' + label);
          }, label + ' ditambahkan');
          editor.focus();
        });
        return b;
      }),
    );
    const cancel = design.parts.length ? el('button', { textContent: 'Batal' }) : null;
    cancel?.addEventListener('click', () => {
      showStart = false;
      render();
    });
    ctxCard.replaceChildren(
      el('h3', { className: 'pl-title', textContent: design.parts.length ? 'Rangkaian baru' : 'Mulai merakit' }),
      el('p', { className: 'note', textContent: 'Pilih seri, ukuran, dan titik awal. Setelah itu ketuk ujung hijau untuk menyambung bagian berikutnya.' }),
      el('div', { className: 'pl-grid2' }, [field('Seri & kelas', seriesSel), field('Ukuran', sizeSel), field('Warna', colorSel), field('Arah awal', dirSel)]),
      el('div', { className: 'pl-grid3' }, [field('X (cm)', xs[0]), field('Y (cm)', xs[1]), field('Z (cm)', xs[2])]),
      presets,
      el('div', { className: 'pl-grid2' }, [field('Panjang pipa (cm)', lenIn), el('div', { className: 'pl-field' }, [el('span', { textContent: ' ' }), bPipe])]),
      el('div', { className: 'pl-grid2' }, [field('atau fitting', typeSel), el('div', { className: 'pl-field' }, [el('span', { textContent: ' ' }), bFit])]),
      el('h4', { className: 'pl-sub', textContent: 'Templat siap pakai' }),
      el('p', {
        className: 'note',
        textContent: 'Posisi sama dengan siphon & selang return di simulasi (seri & kelas mengikuti pilihan di atas). Templat return langsung bisa dihitung hidroliknya dan dipakai di simulasi.',
      }),
      tpl,
      cancel ? el('div', { className: 'btns' }, [cancel]) : null,
    );
  }

  /** Setelah menambah bagian: pilih ujung lanjutan (searah), supaya rangkaian bisa diteruskan cepat. */
  function autoNext(id) {
    const part = design.parts.find((p) => p.id === id);
    const ports = partPorts(part);
    const used = new Set(design.parts.filter((k) => k.parent === id).map((k) => k.pport));
    const cport = part.parent == null ? -1 : part.cport;
    const cd = part.parent == null ? [0, 0, -1] : ports[part.cport].d;
    let best = -1;
    let bestDot = 2;
    ports.forEach((p, i) => {
      if (i === cport || used.has(i)) return;
      const dot = p.d[0] * cd[0] + p.d[1] * cd[1] + p.d[2] * cd[2];
      if (dot < bestDot) {
        bestDot = dot;
        best = i;
      }
    });
    sel = best >= 0 ? { part: null, port: { pid: id, port: best } } : { part: id, port: null };
  }

  function renderPort() {
    const { pid, port } = sel.port;
    const part = design.parts.find((p) => p.id === pid);
    if (!part) {
      sel = { part: null, port: null };
      return render();
    }
    const pp = partPorts(part)[port];
    const list = candidates(pp.end, pp.size, part.cls);
    const lenIn = num(prefs.len / 10, 0.5, (v) => (prefs.len = Math.round(v * 10)), 2, 400);
    const sizeRow = el('div', { className: 'pl-sizes', hidden: true });
    const add = (c, other) =>
      mutate(() => {
        const id = addPart(design, pid, port, { type: c.type, slot: c.slot, other, len: prefs.len, cls: part.cls, color: part.color });
        autoNext(id);
      });
    const groups = {};
    for (const c of list) (groups[TYPES[c.type].cat] ||= []).push(c);
    const blocks = Object.entries(CATS)
      .filter(([k]) => groups[k])
      .map(([k, title]) =>
        el('div', { className: 'pl-cat' }, [
          el('h4', { textContent: title }),
          el(
            'div',
            { className: 'pl-items' },
            groups[k].map((c) => {
              const b = el('button', { className: 'pl-item' + (c.type === 'pipe' ? ' pl-primary' : ''), textContent: c.type === 'pipe' ? `Pipa ${fmt(prefs.len / 10, 1)} cm` : c.label });
              b.addEventListener('click', () => {
                if (!c.other) return add(c);
                // pilih ukuran kedua
                sizeRow.hidden = false;
                sizeRow.replaceChildren(
                  el('span', { textContent: `${c.label}: ukuran ${c.slot === 'a' ? 'ujung kecil' : 'ujung besar'} → ` }),
                  ...c.other.map((s) => {
                    const chip = el('button', { className: 'pl-chip', textContent: SIZES[s].label });
                    chip.addEventListener('click', () => add(c, s));
                    return chip;
                  }),
                );
              });
              return b;
            }),
          ),
        ]),
      );
    lenIn.addEventListener('input', () => {
      const b = ctxCard.querySelector('.pl-item.pl-primary');
      if (b) b.textContent = `Pipa ${fmt(+lenIn.value || 0, 1)} cm`;
    });
    const bPart = el('button', { textContent: `Atur ${TYPES[part.type].name.toLowerCase()} ini` });
    bPart.addEventListener('click', () => {
      sel = { part: pid, port: null };
      editor.select(sel.part, sel.port);
      render();
    });
    ctxCard.replaceChildren(
      el('h3', { className: 'pl-title', textContent: `Sambung ke: ${END_LABEL[pp.end]} ${SIZES[pp.size].label}` }),
      el('p', {
        className: 'note',
        textContent:
          `${portName(part.type, port)[0].toUpperCase() + portName(part.type, port).slice(1)} dari ${partName(part)}. Hanya bagian yang cocok yang ditampilkan.` +
          (pp.end === 'S' ? ' Sok polos hanya menerima pipa (atau bushing) — untuk menyambung fitting lain, pasang potongan pipa pendek dulu, seperti saat merakit sungguhan.' : '') +
          (pp.end === 'F' ? ' Drat dalam menerima bagian berdrat luar; lilitkan seal tape saat merakit.' : ''),
      }),
      el('div', { className: 'pl-grid2' }, [field('Panjang pipa baru (cm)', lenIn), el('div', { className: 'pl-field' }, [el('span', { textContent: ' ' }), bPart])]),
      sizeRow,
      ...blocks,
      list.length ? null : el('p', { className: 'note', textContent: 'Tidak ada bagian yang cocok untuk ujung ini.' }),
    );
  }

  function renderPart() {
    const part = design.parts.find((p) => p.id === sel.part);
    if (!part) {
      sel = { part: null, port: null };
      return render();
    }
    const fr = editor.frames.get(part.id);
    const ports = partPorts(part);
    const rows = [];
    if (part.type === 'pipe') {
      const range = el('input', { type: 'range', min: LEN.min / 10, max: 200, step: 0.5, value: Math.min(200, part.len / 10) });
      const n = num(part.len / 10, 0.5, (v) => mutate(() => updatePart(design, part.id, { len: v * 10 })), LEN.min / 10, LEN.max / 10);
      range.addEventListener('input', () => (n.value = range.value));
      range.addEventListener('change', () => mutate(() => updatePart(design, part.id, { len: +range.value * 10 })));
      // panjang terlihat = potong − bagian yang masuk sok di tiap ujung
      let inside = 0;
      const parent = design.parts.find((p) => p.id === part.parent);
      if (parent && partPorts(parent)[part.pport].end === 'S') inside += dimsSock(parent, part.pport);
      for (const k of design.parts.filter((x) => x.parent === part.id)) if (partPorts(k)[k.cport].end === 'S') inside += dimsSock(k, k.cport);
      rows.push(
        field('Panjang potong (cm)', n),
        range,
        el('p', { className: 'note', textContent: `Terlihat ±${cm(Math.max(0, part.len - inside))} cm (masuk ke sok total ${cm(inside)} cm). Daftar bahan memakai panjang potong.` }),
      );
    }
    if (part.parent != null || TYPES[part.type].cat !== 'pipa') {
      const rot = (d) => mutate(() => updatePart(design, part.id, { roll: part.roll + d }));
      const bL = el('button', { textContent: '⟲ 45°' });
      bL.addEventListener('click', () => rot(-45));
      const bR = el('button', { textContent: '⟳ 45°' });
      bR.addEventListener('click', () => rot(45));
      const b90 = el('button', { textContent: '⟳ 90°' });
      b90.addEventListener('click', () => rot(90));
      const outs = fr
        ? fr.ports
            .map((pt, i) => ({ pt, i }))
            .filter(({ i }) => i !== part.cport || part.parent == null)
            .map(({ pt, i }) => `${portName(part.type, i)} ${dirLabel(pt.d)}`)
            .join(' · ')
        : '';
      rows.push(el('div', { className: 'pl-rot' }, [el('span', { textContent: `Putar di sumbu sambungan (${part.roll}°)` }), el('div', { className: 'btns' }, [bL, bR, b90])]), el('p', { className: 'note', textContent: outs }));
    }
    const alts = altCports(design, part.id);
    if (alts.length > 1 && part.parent != null) {
      rows.push(field('Disambung lewat', select(alts.map((i) => [String(i), portName(part.type, i)]), String(part.cport), (v) => mutate(() => updatePart(design, part.id, { cport: +v })))));
    }
    if (part.parent == null) {
      const a = part.anchor;
      const xs = a.p.map((v, i) =>
        num(v / 10, 0.5, (x) => {
          const p = [...a.p];
          p[i] = x * 10;
          mutate(() => updatePart(design, part.id, { anchor: { p } }));
        }),
      );
      rows.push(
        el('div', { className: 'pl-grid3' }, [field('X (cm)', xs[0]), field('Y (cm)', xs[1]), field('Z (cm)', xs[2])]),
        field('Arah awal', select(Object.entries(DIR_LABEL), a.dir, (v) => mutate(() => updatePart(design, part.id, { anchor: { dir: v } })))),
      );
    }
    rows.push(field('Warna', select(Object.entries(COLORS).map(([k, c]) => [k, c.label]), part.color, (v) => mutate(() => updatePart(design, part.id, { color: v })))));
    const acts = [];
    if (part.type === 'pipe') {
      const inl = select(INLINE.map((t) => [t, TYPES[t].name]), 'ballvalve', () => {});
      const bIns = el('button', { textContent: 'Sisipkan di tengah' });
      bIns.addEventListener('click', () =>
        mutate(() => {
          const r = insertInline(design, part.id, inl.value);
          sel = { part: r.fitting, port: null };
        }, `${TYPES[inl.value].name} disisipkan`),
      );
      rows.push(el('div', { className: 'pl-grid2' }, [field('Sisipkan', inl), el('div', { className: 'pl-field' }, [el('span', { textContent: ' ' }), bIns])]));
    }
    const freeHere = editor.free.filter((f) => f.pid === part.id);
    for (const f of freeHere) {
      const b = el('button', { textContent: `+ dari ${portName(part.type, f.port)}` });
      b.addEventListener('click', () => {
        sel = { part: null, port: { pid: part.id, port: f.port } };
        editor.select(sel.part, sel.port);
        render();
      });
      acts.push(b);
    }
    if (part.parent != null) {
      const bUp = el('button', { textContent: 'Pilih induk' });
      bUp.addEventListener('click', () => {
        sel = { part: part.parent, port: null };
        editor.select(sel.part, sel.port);
        render();
      });
      acts.push(bUp);
    }
    const bNewRun = el('button', { textContent: 'Rangkaian baru' });
    bNewRun.addEventListener('click', () => {
      showStart = true;
      sel = { part: null, port: null };
      editor.select(null, null);
      render();
    });
    acts.push(bNewRun);
    const bDel = el('button', { className: 'pl-danger', textContent: 'Hapus' });
    bDel.addEventListener('click', () => {
      const n = mutate(() => {
        const parent = part.parent;
        const pport = part.pport;
        const count = removePart(design, part.id);
        sel = parent != null ? { part: null, port: { pid: parent, port: pport } } : { part: null, port: null };
        if (!design.parts.length) showStart = true;
        return count;
      });
      if (n) toast(`${n} bagian dihapus — bisa diurungkan`);
    });
    acts.push(bDel);
    ctxCard.replaceChildren(
      el('h3', { className: 'pl-title', textContent: partName(part) }),
      el('p', { className: 'note', textContent: `${ports.length} ujung · ${ports.map((p) => END_LABEL[p.end]).join(', ')}` }),
      ...rows,
      el('div', { className: 'btns' }, acts),
    );
  }

  function dimsSock(part, i) {
    const p = partPorts(part)[i];
    return SIZES[p.size].sock[classFor(p.size, part.cls)];
  }

  function renderIdle() {
    const b = el('button', { className: 'pl-primary', textContent: 'Rangkaian baru' });
    b.addEventListener('click', () => {
      showStart = true;
      render();
    });
    ctxCard.replaceChildren(
      el('h3', { className: 'pl-title', textContent: 'Pilih ujung atau bagian' }),
      el('p', { className: 'note', textContent: `Ketuk titik hijau (ujung terbuka) untuk menyambung, atau ketuk bagian untuk mengatur panjang, putaran, warna, dan menghapusnya. ${editor.free.length} ujung masih terbuka.` }),
      el('div', { className: 'btns' }, [b]),
    );
  }

  /* ---------- alat: ukur & tabrakan (fase 2) ---------- */
  const partById = (id) => design.parts.find((p) => p.id === id);
  function measureText() {
    if (meas.pts.length < 2) return null;
    const [a, b] = meas.pts;
    const d = a.p.map((x, i) => b.p[i] - x);
    return { dist: Math.hypot(...d), d };
  }
  function addMeasurePoint(pt) {
    meas.pts = meas.pts.length >= 2 ? [pt] : [...meas.pts, pt];
    const m = measureText();
    editor.setMeasure(meas.pts, m ? `${cm(m.dist)} cm` : null);
    renderTools();
  }
  function renderTools() {
    const rows = [];
    const bMeas = el('button', { className: meas.on ? 'pl-primary' : '', textContent: meas.on ? 'Selesai mengukur' : 'Ukur jarak' });
    bMeas.addEventListener('click', () => {
      meas.on = !meas.on;
      editor.setMeasuring(meas.on);
      if (meas.on) {
        meas.pts = [];
        editor.setMeasure([]);
      }
      renderTools();
    });
    const acts = [bMeas];
    if (meas.pts.length) {
      const bClr = el('button', { textContent: 'Hapus ukuran' });
      bClr.addEventListener('click', () => {
        meas.pts = [];
        editor.setMeasure([]);
        renderTools();
      });
      acts.push(bClr);
    }
    rows.push(el('div', { className: 'pl-head' }, [el('b', { textContent: 'Alat' }), el('div', { className: 'btns' }, acts)]));
    if (meas.on || meas.pts.length) {
      const m = measureText();
      const lab = (pt) => `${pt.label} (${pt.p.map((x) => cm(x)).join(' · ')})`;
      rows.push(
        el('p', {
          className: 'note',
          textContent: m
            ? `${lab(meas.pts[0])} → ${lab(meas.pts[1])}`
            : meas.pts.length
              ? `Titik 1: ${lab(meas.pts[0])}. Ketuk titik kedua.`
              : 'Ketuk dua titik: ujung hijau, bagian (titik tengahnya), atau kaca/meja.',
        }),
      );
      if (m)
        rows.push(
          el('div', { className: 'pl-meas' }, [
            el('b', { textContent: `${cm(m.dist)} cm` }),
            el('span', { className: 'ax-x', textContent: `Δx ${cm(m.d[0])}` }),
            el('span', { className: 'ax-y', textContent: `Δy ${cm(m.d[1])}` }),
            el('span', { className: 'ax-z', textContent: `Δz ${cm(m.d[2])}` }),
          ]),
        );
    }
    if (design.parts.length) {
      if (!col.hits.length) rows.push(el('p', { className: 'note pl-ok', textContent: '✓ Tidak ada bagian yang menabrak kaca, sekat, pompa, skimmer, meja, atau bagian lain.' }));
      else {
        const list = col.hits.slice(0, 6).map((h) => {
          const part = partById(h.pid);
          const b = el('button', {
            className: 'pl-hit',
            textContent: `${partName(part)} ${h.other != null ? 'bertabrakan dengan ' + partName(partById(h.other)) : 'menembus ' + h.what} (±${fmt(h.depth, 0)} mm)`,
          });
          b.addEventListener('click', () => api.pickPart(h.pid));
          return b;
        });
        rows.push(
          el('p', { className: 'note pl-warn', textContent: `Tabrakan: ${col.hits.length} (bagian merah). Bulkhead boleh menembus kaca. Ketuk untuk memilih bagiannya:` }),
          el('div', { className: 'pl-hits' }, list),
        );
      }
    }
    toolCard.replaceChildren(...rows);
  }

  /* ---------- hidrolik jalur return (fase 3) ---------- */
  function renderHydro() {
    hydCard.hidden = !design.parts.length;
    if (hydCard.hidden) return editor.setSpeedLabels([]);
    const free = editor.free;
    const portLabel = (f) => {
      const part = partById(f.pid);
      return `${partName(part)} · ${portName(part.type, f.port)} · tinggi ${cm(f.p.y)} cm`;
    };
    const opts = [['', '— pilih ujung —'], ...free.map((f) => [endKey(f), portLabel(f)])];
    const recompute = () => {
      analyze();
      persist();
      render();
    };
    const inSel = select(opts, endKey(hyd?.inlet), (v) => {
      sim.inlet = parseEnd(v);
      recompute();
    });
    const outSel = select(opts, endKey(hyd?.outlet), (v) => {
      sim.outlet = parseEnd(v);
      recompute();
    });
    const exitSel = select(Object.entries(EXITS).map(([k, e]) => [k, e.label]), sim.exit, (v) => {
      sim.exit = v;
      recompute();
    });
    const rows = [
      el('p', {
        className: 'note',
        textContent: 'Jalur dari ujung masuk (keluaran pompa) ke ujung keluar: gesek pipa Darcy–Weisbach + rugi fitting metode Crane (K = f_T·L/D) + perubahan diameter, lalu dicari titik kerja di kurva pompa.',
      }),
      el('div', { className: 'pl-grid2' }, [field('Ujung masuk (pompa)', inSel), field('Ujung keluar', outSel)]),
      field('Jenis ujung keluar', exitSel),
    ];
    let speed = [];
    if (!hyd?.ok) rows.push(el('p', { className: 'note pl-warn', textContent: hyd?.error || 'Belum ada jalur.' }));
    else {
      const op = operatingPoints(hyd, app.P, app.S);
      const d = op.design;
      rows.push(
        el('div', { className: 'pl-meas' }, [el('b', { textContent: `±${Math.round(d.Lph)} L/jam` }), el('span', { textContent: `head pompa ${fmt(d.head, 1)} cm` }), el('span', { textContent: `beda statis ${fmt(op.hs, 1)} cm` })]),
        el('p', {
          className: 'note',
          textContent:
            `Pipa return bawaan simulasi pada level yang sama: ±${Math.round(op.base.Lph)} L/jam. Panjang jalur ±${fmt(hyd.lengthCm, 0)} cm, ujung keluar di ${fmt(hyd.zout, 1)} cm. ` +
            `Kecepatan tertinggi ${fmt(op.vmax / 100, 2)} m/s` +
            (op.vmax / 100 > V_HIGH ? ` — di atas ±${fmt(V_HIGH, 1)} m/s (patokan umum pipa tekan): rugi besar dan aliran berisik, pertimbangkan pipa lebih besar.` : '.'),
        }),
      );
      const tbl = el('table', { className: 'el pl-table' }, [
        el('tr', {}, ['Bagian', 'Ø dlm mm', 'v m/s', 'K', 'Rugi cm'].map((t) => el('th', { textContent: t }))),
        ...op.rows.map((r) =>
          el('tr', { title: r.src }, [
            el('td', { textContent: r.label }),
            el('td', { textContent: fmt(r.D * 10, 1) }),
            el('td', { textContent: fmt(r.v / 100, 2) }),
            el('td', { textContent: fmt(r.Kv, 2) }),
            el('td', { textContent: fmt(r.h, 1) }),
          ]),
        ),
      ]);
      rows.push(el('details', {}, [el('summary', { textContent: 'Rincian rugi per bagian' }), tbl, el('p', { className: 'note', textContent: 'K pipa = f·L/D (gesek); knee/tee/valve = f_T·L/D (Crane TP-410); sok, union, adapter, bulkhead = perkiraan. Ketuk lama baris untuk melihat dasarnya.' })]));
      for (const w of hyd.warnings) rows.push(el('p', { className: 'note pl-warn', textContent: w }));
      if (showSpeed)
        speed = op.rows
          .filter((r) => r.kind === 'pipe')
          .map((r) => {
            const f = editor.frames.get(r.pid);
            const a = f.ports[0].p;
            const b = f.ports[1].p;
            return { p: [(a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2], text: `${fmt(r.v / 100, 2)} m/s`, cls: r.v / 100 > V_HIGH ? 'plabel-hi' : '' };
          });
    }
    editor.setSpeedLabels(speed);
    const spd = el('input', { type: 'checkbox', checked: showSpeed, disabled: !hyd?.ok });
    spd.addEventListener('change', () => {
      showSpeed = spd.checked;
      renderHydro();
    });
    const use = el('input', { type: 'checkbox', checked: sim.on && !!hyd?.ok, disabled: !hyd?.ok, id: 'plUseSim' });
    use.addEventListener('change', () => {
      sim.on = use.checked;
      analyze();
      persist();
      logEvent('ubah', `Rakit pipa: pipa return simulasi → ${sim.on ? 'desain "' + design.name + '"' : 'bawaan'}`);
      toast(sim.on ? 'Simulasi memakai jalur desain ini: debit & head pompa mengikuti desain' : 'Simulasi kembali memakai pipa return bawaan');
      renderHydro();
    });
    rows.push(
      el('label', { className: 'tg' }, [spd, el('span', { textContent: 'Tampilkan kecepatan di tiap pipa (3D)' })]),
      el('label', { className: 'tg pl-use' }, [use, el('span', { textContent: 'Pakai sebagai pipa return di simulasi' })]),
      el('p', {
        className: 'note',
        textContent: 'Saat dipakai: debit, head pompa, dan inersia kolom air di simulasi mengikuti desain (juga saat padam). Posisi & arah duckbill di simulasi arus tetap dari pengaturan Return/duckbill.',
      }),
      hydLive,
    );
    hydCard.replaceChildren(el('details', { open: true }, [el('summary', { textContent: 'Hidrolik jalur return' }), ...rows]));
    tickLive(true);
  }

  let liveAt = 0;
  function tickLive(force) {
    const now = performance.now();
    if (!force && now - liveAt < 500) return;
    liveAt = now;
    if (hydCard.hidden) return;
    const q = app.S.q;
    hydLive.textContent = `Simulasi sekarang: ${Math.round(Math.max(0, q.r) * 3.6)} L/jam · head ${fmt(q.hp, 1)} cm · pipa return ${app.P.retLine ? 'dari desain' : 'bawaan'}${app.P.on ? '' : ' (listrik padam)'}`;
  }

  function renderBom() {
    const b = bom(design, { stick: prefs.stick });
    const box = editor.bounds();
    const parts = [];
    if (!b.parts) {
      bomBox.replaceChildren(el('p', { className: 'note', textContent: 'Belum ada bagian.' }));
      return;
    }
    const stickSel = select(
      [
        ['3000', '3 m'],
        ['4000', '4 m'],
        ['5000', '5 m'],
        ['6000', '6 m'],
      ],
      String(prefs.stick),
      (v) => {
        prefs.stick = +v;
        renderBom();
      },
    );
    parts.push(field('Panjang batang pipa', stickSel));
    if (b.pipes.length) {
      parts.push(
        el('table', { className: 'el pl-table' }, [
          el('tr', {}, ['Pipa', 'Potongan (cm)', 'Batang'].map((t) => el('th', { textContent: t }))),
          ...b.pipes.map((g) =>
            el('tr', {}, [
              el('td', { textContent: g.label }),
              el('td', { textContent: g.cuts.map(cm).join(', ') + ` (Σ ${cm(g.total)})` }),
              el('td', { textContent: g.sticks + (g.tooLong.length ? ` +${g.tooLong.length} panjang` : '') }),
            ]),
          ),
        ]),
      );
    }
    if (b.items.length) {
      parts.push(
        el('table', { className: 'el pl-table' }, [
          el('tr', {}, ['Fitting', 'Jumlah'].map((t) => el('th', { textContent: t }))),
          ...b.items.map((it) => el('tr', {}, [el('td', { textContent: it.name }), el('td', { textContent: String(it.count) })])),
        ]),
      );
    }
    const j = b.joints;
    parts.push(
      el('p', { className: 'note', textContent: `Sambungan: ${j.solvent} lem${j.thread ? ` · ${j.thread} drat (seal tape)` : ''}${j.flange ? ` · ${j.flange} flange` : ''}.` }),
    );
    if (b.open.length) parts.push(el('p', { className: 'note pl-warn', textContent: `Ujung terbuka: ${b.open.length} (${b.open.map((o) => o.label).join(', ')})` }));
    if (!box.isEmpty()) {
      const s = box.getSize(box.min.clone());
      parts.push(el('p', { className: 'note', textContent: `Ukuran rakitan ±${fmt(s.x, 1)} × ${fmt(s.y, 1)} × ${fmt(s.z, 1)} cm (lebar × tinggi × dalam).` }));
    }
    const bCopy = el('button', { textContent: 'Salin daftar bahan' });
    bCopy.addEventListener('click', async () => {
      const md = bomMarkdown(b, design.name);
      try {
        await navigator.clipboard.writeText(md);
        toast('Daftar bahan disalin');
      } catch {
        download(`${design.name}-daftar-bahan.md`, md, 'text/markdown');
      }
    });
    parts.push(el('div', { className: 'btns' }, [bCopy]));
    bomBox.replaceChildren(...parts);
  }

  function render() {
    bUndo.disabled = !undo.length;
    bRedo.disabled = !redo.length;
    nameIn.value = design.name;
    if (showStart || !design.parts.length) renderStart();
    else if (sel.port) renderPort();
    else if (sel.part != null) renderPart();
    else renderIdle();
    renderTools();
    renderHydro();
    renderBom();
  }

  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = el('a', { href: url, download: name.replace(/[\\/:*?"<>|]+/g, '-') });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  renderLoad();
  editor.rebuild(design);
  analyze();
  render();

  const api = {
    /** Dipanggil editor saat bagian diketuk (null = area kosong). */
    pickPart(id) {
      if (meas.on) {
        if (id == null) return toast('Ketuk ujung hijau, bagian, atau kaca/meja untuk titik ukur');
        const part = partById(id);
        const f = editor.frames.get(id);
        const c =
          part.type === 'pipe'
            ? [0, 1, 2].map((i) => (f.ports[0].p.getComponent(i) + f.ports[1].p.getComponent(i)) / 2)
            : [f.m.elements[12], f.m.elements[13], f.m.elements[14]];
        return addMeasurePoint({ p: c, label: partName(part) + ' (tengah)' });
      }
      sel = { part: id, port: null };
      showStart = false;
      editor.select(sel.part, sel.port);
      render();
    },
    pickPort(pid, port) {
      if (meas.on) {
        const pt = editor.frames.get(pid).ports[port];
        return addMeasurePoint({ p: [pt.p.x, pt.p.y, pt.p.z], label: 'ujung ' + partName(partById(pid)) });
      }
      sel = { part: null, port: { pid, port } };
      showStart = false;
      editor.select(sel.part, sel.port);
      render();
    },
    /** Titik ukur di kaca/meja (dari editor). */
    pickPoint(pt) {
      if (meas.on) addMeasurePoint(pt);
    },
    /** Tiap frame dari main.js: baris "simulasi sekarang" di kartu hidrolik. */
    tick() {
      tickLive(false);
    },
    get design() {
      return design;
    },
    get refVisible() {
      return refVisible;
    },
    get hydro() {
      return hyd;
    },
    get collisions() {
      return col;
    },
    // akses uji otomatis
    mutate,
  };
  return api;
}

