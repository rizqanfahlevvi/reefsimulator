/**
 * Diagnostik lokal: catatan kejadian (langkah pengguna, perubahan otomatis, error) yang bisa
 * disalin pengguna sebagai teks laporan. Tidak ada yang dikirim ke server mana pun.
 */
const MAX_EVENTS = 40;

export const diag = {
  /** @type {{at: string, kind: string, msg: string, n: number}[]} */
  events: [],
  errors: 0,
  fps: 0,
  listeners: new Set(),
};

const clock = () => {
  const d = new Date();
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((v) => String(v).padStart(2, '0')).join('.');
};

/**
 * Catat kejadian. kind: 'error' | 'warn' | 'info' | 'auto' | 'ubah' | 'klik' | 'studi'.
 * Kejadian yang sama berturut-turut digabung (×n) supaya error per frame tidak membanjiri log.
 */
export function logEvent(kind, msg) {
  const text = String(msg).replace(/\s+/g, ' ').trim().slice(0, 300);
  const last = diag.events[diag.events.length - 1];
  if (last && last.kind === kind && last.msg === text) {
    last.n++;
    last.at = clock();
  } else {
    diag.events.push({ at: clock(), kind, msg: text, n: 1 });
    if (diag.events.length > MAX_EVENTS) diag.events.shift();
  }
  if (kind === 'error') diag.errors++;
  for (const fn of diag.listeners) fn(kind, text);
}

/** Langganan kejadian baru; mengembalikan fungsi untuk berhenti berlangganan. */
export function onDiag(fn) {
  diag.listeners.add(fn);
  return () => diag.listeners.delete(fn);
}

/** Pesan error ringkas + lokasi kode pertama (tanpa domain). */
export function errorText(err) {
  if (err == null) return 'tidak diketahui';
  const msg = err.message || String(err);
  const at = String(err.stack || '')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => /\.(js|mjs)/.test(l) && !l.includes(msg));
  if (!at) return msg;
  const where = at.replace(/^at\s+/, '').replace(/https?:\/\/[^/\s)]+\//g, '');
  return `${msg} (${where})`;
}

let installed = false;
/** Tangkap error global, promise yang gagal, dan modul build lama yang hilang setelah deploy baru. */
export function installGlobalHandlers() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', (e) => {
    if (e.error) logEvent('error', errorText(e.error));
    else if (e.message) logEvent('error', `${e.message} (${String(e.filename || '').split('/').pop()}:${e.lineno || 0})`);
  });
  window.addEventListener('unhandledrejection', (e) => logEvent('error', 'Promise: ' + errorText(e.reason)));
  // halaman lama masih terbuka saat versi baru di-deploy → potongan modul lama tidak ada lagi: muat ulang sekali
  window.addEventListener('vite:preloadError', (e) => {
    logEvent('error', 'Gagal memuat modul: ' + errorText(e.payload));
    try {
      if (!sessionStorage.getItem('reefsim:reload')) {
        sessionStorage.setItem('reefsim:reload', '1');
        e.preventDefault();
        location.reload();
      }
    } catch {
      /* sessionStorage tidak tersedia: biarkan error tercatat */
    }
  });
}
