/**
 * Tab Analisis: profil biota, saran otomatis (diperbarui tiap ±1 dtk), cari titik seimbang,
 * uji pulsa standar, laporan untuk Claude Project, dan pustaka.
 */
/* global __APP_VERSION__ */
import { app } from '../state.js';
import { analyze, applyAction, CATEGORIES, LEVEL_LABEL } from '../analysis/advisor.js';
import { findBalance, runChunked } from '../analysis/equilibrium.js';
import { PulseTest, PULSE } from '../analysis/pulse.js';
import { buildReport, projectInstructions } from '../analysis/report.js';
import { REFERENCES, REF_INDEX, EVIDENCE, refLink } from '../analysis/references.js';
import { PROFILES, PROFILE_OPTIONS } from '../analysis/profiles.js';
import { energyStats, EL } from './electricity.js';
import { logEvent } from '../diag.js';
import { el } from '../util/format.js';
import { toast } from './toast.js';

const VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
const ICON = { bad: '✗', warn: '!', info: 'i', ok: '✓' };

/**
 * @param {HTMLElement} root bagian tab Analisis
 * @param {object} ctx {flow, applied(), notify(msg), setBadge(n, level), showDye()}
 */
export function buildAnalysis(root, ctx) {
  const { flow } = ctx;
  const pulse = new PulseTest();
  let eq = null;
  let eqRunning = false;
  let last = null;
  let lastKey = '';
  let showOk = false;

  /* ---------- profil + ringkasan + daftar saran ---------- */
  const card = el('div', { className: 'card' });
  const profSel = el('select', { id: 'anProfile', style: 'width:100%' }, PROFILE_OPTIONS.map(([v, t]) => el('option', { value: v, textContent: t })));
  profSel.value = app.profile;
  const profWhy = el('p', { className: 'note' });
  profSel.addEventListener('change', () => {
    app.profile = profSel.value;
    profWhy.textContent = PROFILES[app.profile].why;
    refresh(true);
  });
  profWhy.textContent = (PROFILES[app.profile] || PROFILES.fowlr).why;
  const summary = el('div', { className: 'an-summary' });
  const list = el('div', { className: 'an-list' });
  const okToggle = el('button', { className: 'an-oktoggle' });
  okToggle.addEventListener('click', () => {
    showOk = !showOk;
    refresh(true);
  });
  card.append(
    el('label', { className: 'row', htmlFor: 'anProfile', textContent: 'Profil biota (menentukan target arus & salinitas)' }),
    profSel,
    profWhy,
    summary,
    list,
    okToggle,
    el('p', {
      className: 'note',
      textContent:
        'Saran dihitung otomatis dari simulasi setiap ±1 detik dengan aturan tetap (tanpa AI, tanpa internet). Tingkat bukti: A = ' +
        EVIDENCE.A + ', B = ' + EVIDENCE.B + ', C = ' + EVIDENCE.C + '. Angka [n] merujuk ke Pustaka di bawah.',
    }),
  );

  const details = (title, children) => el('details', {}, [el('summary', { textContent: title }), ...children]);

  /* ---------- cari titik seimbang ---------- */
  const eqOut = el('div', { className: 'an-eq' });
  const eqBtn = el('button', { textContent: 'Cari titik seimbang' });
  const eqProg = el('p', { className: 'note' });
  eqBtn.addEventListener('click', async () => {
    if (eqRunning) return;
    eqRunning = true;
    eqBtn.disabled = true;
    eqOut.replaceChildren();
    logEvent('info', 'Cari titik seimbang dimulai');
    try {
      eq = await runChunked(findBalance(app.S, app.P), (p) => (eqProg.textContent = `Mensimulasikan bukaan valve… ${Math.round((p.done / p.total) * 100)}%`));
      eqProg.textContent = '';
      renderEq();
      refresh(true);
      logEvent('info', 'Titik seimbang: ' + eq.note);
    } catch (err) {
      eqProg.textContent = 'Gagal: ' + (err?.message || err);
      logEvent('error', 'Cari titik seimbang gagal: ' + (err?.message || err));
    }
    eqRunning = false;
    eqBtn.disabled = false;
  });
  function renderEq() {
    if (!eq) return;
    const rows = eq.rows.map((r) =>
      el('tr', { className: r === eq.best ? 'best' : '' }, [
        el('td', { textContent: Math.round(r.sv * 100) + '%' }),
        el('td', { textContent: r.HT.toFixed(1).replace('.', ',') }),
        el('td', { textContent: r.ok ? (r.robust ? 'stabil · cadangan ok' : r.robust === false ? 'stabil · cadangan tipis' : 'stabil') : r.why.join(', ') }),
      ]),
    );
    const tbl = el('table', { className: 'el an-table' }, [el('tr', {}, ['Valve', 'Level (cm)', 'Status'].map((t) => el('th', { textContent: t }))), ...rows]);
    const parts = [el('p', { className: 'an-note', textContent: eq.note })];
    if (eq.best) {
      const b = el('button', { textContent: `Terapkan valve U-pipe ${Math.round(eq.best.sv * 100)}%` });
      b.addEventListener('click', () => {
        app.P.sv = eq.best.sv;
        ctx.applied();
        ctx.notify(`Valve U-pipe diatur ke ${Math.round(eq.best.sv * 100)}%`);
      });
      parts.push(b);
    } else if (eq.maxSpd) {
      const b = el('button', { textContent: `Terapkan daya pompa ${Math.round(eq.maxSpd * 100)}% + valve 100%` });
      b.addEventListener('click', () => {
        app.P.spd = Math.round(eq.maxSpd * 100) / 100;
        app.P.sv = 1;
        ctx.applied();
        ctx.notify('Daya pompa & valve U-pipe diatur');
      });
      parts.push(b);
    }
    parts.push(tbl);
    eqOut.replaceChildren(...parts);
  }
  const eqBox = details('Cari titik seimbang (valve U-pipe)', [
    el('p', {
      className: 'note',
      textContent:
        'Model hidrolik dijalankan di latar untuk bukaan valve U-pipe 5–100% sampai level tunak. Dipilih bukaan paling tertutup yang tetap stabil (siphon penuh tanpa gluk-gluk, pelampung atas tidak memutus pompa, level ≤ 28,3 cm) dan masih stabil bila debit pompa naik 20%. Level lebih tinggi berarti surface skimmer bekerja lebih baik, cadangan +20% menjaga dari penyumbatan. Butuh beberapa detik.',
    }),
    el('div', { className: 'btns' }, [eqBtn]),
    eqProg,
    eqOut,
  ]);

  /* ---------- uji pulsa ---------- */
  const pBtn = el('button', { textContent: 'Mulai uji pulsa' });
  const pProg = el('p', { className: 'note' });
  const pOut = el('div');
  pBtn.addEventListener('click', () => {
    if (pulse.state === 'warmup' || pulse.state === 'running') {
      pulse.abort('dibatalkan pengguna');
      return;
    }
    if (!app.V.cfd) {
      app.V.cfd = true;
      ctx.applied();
    }
    pulse.start(flow);
    ctx.showDye?.();
    logEvent('info', 'Uji pulsa dimulai');
  });
  const pBox = details('Uji pulsa standar (tracer)', [
    el('p', {
      className: 'note',
      textContent: `Setelah arus berkembang (${PULSE.warmup} dtk simulasi), pewarna dilepas ${PULSE.dur} dtk dari duckbill. Direkam: kadar di tank, filter, dan intake siphon, serta keseragamannya. Hasil: waktu sampai tank homogen 95% (t95), waktu tiba di intake, dan tanda jalan pintas — dibandingkan dengan waktu tinggal τ. Jangan ubah pengaturan selama uji; di HP bisa butuh beberapa menit.`,
    }),
    el('div', { className: 'btns' }, [pBtn]),
    pProg,
    pOut,
  ]);
  let pulseShown = null;
  function renderPulse() {
    const running = pulse.state === 'warmup' || pulse.state === 'running';
    pBtn.textContent = running ? 'Batalkan uji' : pulse.state === 'done' || pulse.state === 'aborted' ? 'Ulangi uji pulsa' : 'Mulai uji pulsa';
    pProg.textContent = pulse.progress(flow);
    if (pulse.result && pulseShown !== pulse.result) {
      pulseShown = pulse.result;
      const r = pulse.result;
      pOut.replaceChildren(el('p', { className: 'an-note an-' + r.level, textContent: r.summary }), el('p', { className: 'note', textContent: r.advice }));
      logEvent('info', 'Uji pulsa selesai: ' + r.summary);
      refresh(true);
    }
  }

  /* ---------- laporan untuk Claude ---------- */
  const rStatus = el('p', { className: 'note' });
  const area = el('textarea', { className: 'diag-text', readOnly: true, rows: 8, hidden: true, ariaLabel: 'Isi laporan' });
  const fileName = () => {
    const d = new Date();
    const p = (v) => String(v).padStart(2, '0');
    return `analisis-reef-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.md`;
  };
  const report = () =>
    buildReport({
      app,
      stats: app.flowStats,
      cfd: { on: app.V.cfd, mode: flow.mode, msPerStep: flow.perf.ms, ratio: flow.perf.ratio, cfdTime: flow.cfdTime, cfdAge: flow.cfdAge },
      analysis: current(),
      eq,
      pulse: pulse.result,
      energy: energyStats(app, EL),
      version: VERSION,
      date: new Date(),
    });
  async function copyText(text, what) {
    try {
      await navigator.clipboard.writeText(text);
      toast(what + ' disalin — tempel di Claude');
    } catch {
      area.value = text;
      area.hidden = false;
      area.focus();
      area.select();
      toast('Salin manual: tekan lama teks → Salin');
    }
  }
  const bDl = el('button', { textContent: 'Unduh .md' });
  bDl.addEventListener('click', () => {
    const md = report();
    const url = URL.createObjectURL(new Blob([md], { type: 'text/markdown;charset=utf-8' }));
    const a = el('a', { href: url, download: fileName() });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    rStatus.textContent = `Laporan diunduh (${Math.round(md.length / 1024)} KB). Unggah ke Claude Project → Project knowledge, atau lampirkan di chat Project.`;
    logEvent('info', 'Laporan analisis diunduh');
  });
  const bCopy = el('button', { textContent: 'Salin laporan' });
  bCopy.addEventListener('click', () => copyText(report(), 'Laporan'));
  const reportBtns = [bDl, bCopy];
  if (navigator.share) {
    const bShare = el('button', { textContent: 'Bagikan…' });
    bShare.addEventListener('click', async () => {
      const md = report();
      const file = new File([md], fileName(), { type: 'text/plain' });
      try {
        if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: 'Laporan analisis reef tank' });
        else await navigator.share({ title: 'Laporan analisis reef tank', text: md });
      } catch {
        /* dibatalkan pengguna */
      }
    });
    reportBtns.push(bShare);
  }
  const bInstr = el('button', { textContent: 'Salin instruksi Project' });
  bInstr.addEventListener('click', () => copyText(projectInstructions(), 'Instruksi Project'));
  const rBox = details('Laporan untuk Claude Project', [
    el('p', {
      className: 'note',
      textContent:
        'Laporan Markdown berisi semua parameter dan hasil: konfigurasi, hidrolik, arus CFD (termasuk sekitar batu), umur air & pertukaran, salinitas lokal, uji pulsa, titik seimbang, saran + rujukan, listrik, batasan model, dan lampiran JSON. ' +
        'Sekali saja: tekan "Salin instruksi Project" dan tempel di pengaturan instruksi Claude Project-mu supaya cara analisisnya konsisten. Jalankan uji pulsa & cari titik seimbang dulu agar laporannya lengkap.',
    }),
    el('div', { className: 'btns' }, reportBtns),
    el('div', { className: 'btns' }, [bInstr]),
    rStatus,
    area,
  ]);

  /* ---------- pustaka ---------- */
  const refList = el(
    'ol',
    { className: 'an-refs' },
    REFERENCES.map((r, i) => {
      const link = refLink(r);
      return el('li', { id: 'ref-' + (i + 1) }, [
        el('span', { textContent: r.cite + ' ' }),
        link ? el('a', { href: link, target: '_blank', rel: 'noopener noreferrer', textContent: r.doi ? 'doi:' + r.doi : 'tautan' }) : null,
        el('span', { className: 'an-use', textContent: ` — ${r.use} ` }),
        el('b', { className: 'an-ev', textContent: r.ev }),
      ]);
    }),
  );
  const refBox = details('Pustaka & tingkat bukti', [
    el('p', {
      className: 'note',
      textContent: `A = ${EVIDENCE.A}; B = ${EVIDENCE.B}; C = ${EVIDENCE.C}. Bibliografi dan DOI dicek di halaman penerbit/indeks; referensi yang DOI-nya tidak bisa dipastikan dicantumkan tanpa DOI.`,
    }),
    refList,
  ]);

  const tools = el('div', { className: 'card' }, [eqBox, pBox, rBox, refBox]);
  root.append(card, tools);

  /* ---------- render saran ---------- */
  function current() {
    last = analyze({ app, stats: app.flowStats, cfdAge: flow.cfdAge, eq, pulse: pulse.result ? { result: pulse.result } : null });
    return last;
  }
  function openRef(n) {
    refBox.open = true;
    document.getElementById('ref-' + n)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  function findingNode(f) {
    const head = el('div', { className: 'an-head' }, [
      el('span', { className: 'an-icon', textContent: ICON[f.level] }),
      el('b', { textContent: f.title }),
      el('span', { className: 'an-ev', title: 'Tingkat bukti: ' + EVIDENCE[f.ev], textContent: f.ev }),
    ]);
    const body = [head, el('div', { className: 'an-now', textContent: `Sekarang: ${f.now} · Target: ${f.target}` })];
    if (f.advice) body.push(el('div', { className: 'an-adv', textContent: f.advice }));
    const foot = [];
    if (f.refs?.length) {
      for (const id of f.refs) {
        const nRef = REF_INDEX[id];
        if (!nRef) continue;
        const a = el('button', { className: 'an-ref', textContent: '[' + nRef + ']', title: REFERENCES[nRef - 1].cite });
        a.addEventListener('click', () => openRef(nRef));
        foot.push(a);
      }
    }
    if (f.action) {
      const b = el('button', { className: 'an-act', textContent: f.action.label });
      b.addEventListener('click', () => {
        applyAction(app, f.action);
        ctx.applied();
        ctx.notify(f.action.label);
        refresh(true);
      });
      foot.push(b);
    }
    if (foot.length) body.push(el('div', { className: 'an-foot' }, foot));
    return el('div', { className: 'an-item an-' + f.level }, body);
  }
  function refresh(force = false) {
    const r = current();
    const bad = r.count.bad;
    const warn = r.count.warn;
    ctx.setBadge(bad + warn, bad ? 'bad' : warn ? 'warn' : '');
    if (!force && root.hidden) return;
    const key = showOk + '|' + r.findings.map((f) => f.id + f.level + f.now + (f.action ? 1 : 0)).join('|');
    if (!force && key === lastKey) return;
    lastKey = key;
    summary.replaceChildren(
      ...['bad', 'warn', 'info', 'ok'].map((l) => el('span', { className: 'an-chip an-' + l, textContent: `${r.count[l]} ${LEVEL_LABEL[l].toLowerCase()}` })),
    );
    const nodes = [];
    for (const [cat, title] of Object.entries(CATEGORIES)) {
      const fs = r.findings.filter((f) => f.cat === cat && (showOk || f.level !== 'ok'));
      if (!fs.length) continue;
      nodes.push(el('h3', { className: 'an-cat', textContent: title }), ...fs.map(findingNode));
    }
    if (!nodes.length) nodes.push(el('p', { className: 'note', textContent: 'Tidak ada yang perlu disetel. 👍' }));
    list.replaceChildren(...nodes);
    okToggle.textContent = showOk ? 'Sembunyikan yang sudah baik' : `Tampilkan ${r.count.ok} hal yang sudah baik`;
    okToggle.hidden = r.count.ok === 0;
  }

  let acc = 0;
  return {
    /** Dipanggil dari loop UI (±0,2 dtk). */
    update(dt) {
      pulse.tick(flow, app);
      if (!root.hidden) renderPulse();
      acc += dt;
      if (acc >= 1) {
        acc = 0;
        refresh();
      }
    },
    refresh,
    report,
    syncProfile() {
      profSel.value = app.profile;
      profWhy.textContent = (PROFILES[app.profile] || PROFILES.fowlr).why;
    },
    get pulse() {
      return pulse;
    },
  };
}
