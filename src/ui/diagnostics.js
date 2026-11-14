/**
 * Laporan masalah: ringkasan kesehatan aplikasi (FPS, kecepatan CFD, error) dan laporan teks
 * yang bisa disalin/dibagikan pengguna — pengganti screenshot. Semua dibuat di perangkat;
 * tidak ada yang dikirim otomatis.
 */
/* global __APP_VERSION__, __BUILD_TIME__ */
import { app, salinity } from '../state.js';
import { snapshot } from '../settings.js';
import { diag, onDiag } from '../diag.js';
import { el, fmt, $ } from '../util/format.js';
import { toast } from './toast.js';

const QUALITY = ['Tinggi', 'Tinggi (hemat piksel)', 'Sedang', 'Hemat'];
const VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
const BUILT = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : '-';

/** Nama GPU / renderer WebGL (untuk melacak masalah khusus perangkat). */
function gpuName(world) {
  try {
    const gl = world?.renderer.getContext();
    if (!gl) return 'tidak ada (3D gagal dibuat)';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const r = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    return `${r} · WebGL ${gl instanceof WebGL2RenderingContext ? '2' : '1'}${gl.isContextLost() ? ' · CONTEXT HILANG' : ''}`;
  } catch {
    return 'tidak diketahui';
  }
}

/** Label kontrol untuk laporan (teks label tanpa angka nilai). */
function controlLabel(e) {
  const lab = document.querySelector(`label[for="${e.id}"]`);
  return (lab?.querySelector('span')?.textContent || lab?.textContent || e.closest('label')?.textContent || e.id).trim().slice(0, 60);
}

/**
 * @param {{getWorld: () => any, flow: any, getStudy: () => any, EL: any, getTab: () => string, openDiag: () => void}} ctx
 */
export function buildDiagnostics(ctx) {
  const { flow } = ctx;

  function healthLine() {
    const w = ctx.getWorld();
    const p = flow.perf;
    const q = w ? QUALITY[w.quality] || w.quality : '-';
    const cfd = app.V.cfd
      ? `CFD ${fmt(p.ms, 0)} ms/langkah (${flow.mode === 'worker' ? 'worker' : 'thread utama'}), mengikuti ${fmt(p.ratio * 100, 0)}% waktu simulasi`
      : 'CFD mati';
    return `FPS ${fmt(diag.fps, 0)} · grafis ${q} · ${cfd} · error ${diag.errors}`;
  }

  function report() {
    const w = ctx.getWorld();
    const { S, P, V } = app;
    const q = S.q;
    const p = flow.perf;
    const snap = snapshot(app, ctx.EL);
    delete snap.EL; // tabel listrik tidak relevan untuk masalah tampilan/arus
    const locked = [...document.querySelectorAll('#controls input:disabled, #controls select:disabled')].map(controlLabel);
    const L = [
      'LAPORAN DIAGNOSTIK — Simulasi Reef Tank',
      `Waktu: ${new Date().toLocaleString('id-ID')}`,
      `Versi: ${VERSION} (build ${BUILT})`,
      `Perangkat: ${navigator.userAgent}`,
      `Layar: ${innerWidth}×${innerHeight} @${fmt(devicePixelRatio || 1, 2)}x · tab terbuka: ${ctx.getTab()}`,
      `GPU: ${gpuName(w)} · context hilang ${diag.gpu.lost}× sesi ini · mode ringan tingkat ${diag.gpu.strain}${w ? ' · langkah kabut ' + w.fogStep : ''}`,
      `Grafis: ${w ? QUALITY[w.quality] : '-'} (${app.quality === 'a' ? 'otomatis' : 'manual'}) · FPS ${fmt(diag.fps, 0)}`,
      `CFD: ${V.cfd ? 'nyala' : 'mati'} · ${flow.mode} · ${fmt(p.ms, 0)} ms/langkah · mengikuti ${fmt(p.ratio * 100, 0)}% waktu simulasi · ` +
        `waktu CFD ${fmt(flow.cfdTime, 0)} dtk · diulang ${p.resets}× · error ${p.errors} · worker dimulai ulang ${p.restarts}×`,
      `Simulasi: t ${fmt(S.t, 0)} dtk · ${app.SPD}× · ${app.paused ? 'DIJEDA' : 'berjalan'} · listrik ${P.on ? 'nyala' : 'mati'}`,
      `Level (cm): tank ${fmt(S.HT)} · ch1 ${fmt(S.H1)} · ch2 ${fmt(S.H2)} · ch3 ${fmt(S.H3)} · pompa ${fmt(S.HP)}`,
      `Debit (L/jam): siphon ${Math.round(q.s * 3.6)} · return ${Math.round(q.r * 3.6)} · salinitas ${fmt(salinity(), 2)} ppt`,
      `Studi aktif: ${ctx.getStudy()?.title || '-'}`,
      `Kontrol terkunci: ${locked.length ? locked.join('; ') : 'tidak ada'}`,
      `Pengaturan: ${JSON.stringify(snap)}`,
      `Kejadian terakhir (${diag.events.length}, terlama di atas):`,
      ...diag.events.map((e) => `  ${e.at} [${e.kind}] ${e.msg}${e.n > 1 ? ` (×${e.n})` : ''}`),
    ];
    return L.join('\n');
  }

  /* ---------- kartu di tab Tampilan ---------- */
  const live = el('p', { className: 'note diag-live', textContent: '-' });
  const area = el('textarea', { className: 'diag-text', readOnly: true, rows: 9, hidden: true, ariaLabel: 'Isi laporan diagnostik' });
  const showText = (text) => {
    area.value = text;
    area.hidden = false;
    ctx.openDiag();
    area.focus();
    area.select();
  };
  async function copy() {
    const text = report();
    try {
      await navigator.clipboard.writeText(text);
      toast('Laporan disalin — tempel (paste) di chat');
    } catch {
      showText(text);
      toast('Salin manual: tekan lama teks laporan → Salin');
    }
  }
  const bCopy = el('button', { textContent: 'Salin laporan' });
  bCopy.addEventListener('click', copy);
  const bShow = el('button', { textContent: 'Lihat isi laporan' });
  bShow.addEventListener('click', () => (area.hidden ? showText(report()) : (area.hidden = true)));
  const btns = el('div', { className: 'btns' }, [bCopy]);
  if (navigator.share) {
    const bShare = el('button', { textContent: 'Bagikan…' });
    bShare.addEventListener('click', () => navigator.share({ title: 'Laporan diagnostik reef simulator', text: report() }).catch(() => {}));
    btns.append(bShare);
  }
  btns.append(bShow);
  const box = el('div', {}, [
    el('p', {
      className: 'note',
      textContent:
        'Ada yang aneh (error, macet, tampilan kosong, kontrol tidak merespons)? Tekan "Salin laporan" lalu tempel di chat — tidak perlu screenshot. ' +
        'Isinya: versi aplikasi, jenis perangkat & GPU, FPS, kecepatan CFD, pengaturan, dan 40 kejadian terakhir (langkah yang kamu lakukan + error). ' +
        'Laporan hanya dibuat di perangkat ini; tidak ada yang dikirim otomatis.',
    }),
    live,
    btns,
    area,
  ]);

  /* ---------- lencana error di tampilan 3D ---------- */
  const badge = el('button', { id: 'diagBadge', hidden: true, title: 'Salin laporan diagnostik' });
  badge.addEventListener('click', copy);
  ($('hud') || $('view'))?.append(badge);
  const updBadge = () => {
    badge.hidden = diag.errors === 0;
    badge.textContent = `⚠ ${diag.errors} error · ketuk untuk salin laporan`;
  };
  onDiag((kind) => kind === 'error' && updBadge());
  updBadge();

  return {
    box,
    report,
    /** Dipanggil berkala dari loop UI. */
    update() {
      if (box.isConnected && box.offsetParent !== null) {
        const t = healthLine();
        if (live.textContent !== t) live.textContent = t;
      }
    },
  };
}
