/**
 * Gaya tampilan panel: 'real' (bawaan) atau 'clay' (claymorphism, lihat body.clay di styles.css).
 * Slider clay digambar sendiri, jadi persentase nilainya (--p) diperbarui di sini supaya bagian
 * terisi tetap terlihat — saat digeser maupun saat nilainya diubah program (sinkronisasi panel).
 */
let timer = null;

function refreshRanges(root = document) {
  for (const r of root.querySelectorAll('input[type="range"]')) {
    const min = +r.min || 0;
    const max = r.max === '' ? 100 : +r.max;
    const p = (((+r.value - min) / (max - min || 1)) * 100).toFixed(1) + '%';
    if (r.style.getPropertyValue('--p') !== p) r.style.setProperty('--p', p);
  }
}

document.addEventListener(
  'input',
  (e) => {
    if (timer && e.target instanceof HTMLInputElement && e.target.type === 'range') refreshRanges(e.target.parentElement || document);
  },
  true,
);

/** Terapkan gaya panel. */
export function applyUIStyle(style) {
  const on = style === 'clay';
  document.body.classList.toggle('clay', on);
  if (on) {
    refreshRanges();
    timer ??= setInterval(refreshRanges, 700);
  } else if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
