/**
 * Warna kecepatan arus (cm/s) → RGB 0..1.
 * <1 merah (zona mati), 1–3 kuning (lemah), 3–8 hijau (sedang), >8 putih kebiruan (kuat).
 */
export function speedColor(s, o) {
  if (s < 1) {
    o[0] = 0.93;
    o[1] = 0.18;
    o[2] = 0.2;
  } else if (s < 3) {
    const t = (s - 1) / 2;
    o[0] = 0.93 + 0.07 * t;
    o[1] = 0.18 + 0.66 * t;
    o[2] = 0.2;
  } else if (s < 8) {
    const t = (s - 3) / 5;
    o[0] = 1 - 0.82 * t;
    o[1] = 0.84 + 0.06 * t;
    o[2] = 0.2 + 0.42 * t;
  } else {
    const t = Math.min(1, (s - 8) / 14);
    o[0] = 0.18 + 0.72 * t;
    o[1] = 0.9 + 0.08 * t;
    o[2] = 0.62 + 0.38 * t;
  }
  return o;
}
