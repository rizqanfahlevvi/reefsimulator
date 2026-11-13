/** Angka dengan koma desimal (format Indonesia). */
export const fmt = (v, d = 1) => (+v).toFixed(d).replace('.', ',');

/** Rupiah tanpa desimal. */
export const rupiah = (x) => 'Rp ' + Math.round(x).toLocaleString('id-ID');

/** getElementById singkat. */
export const $ = (id) => document.getElementById(id);

/** Buat elemen dengan properti dan anak. */
export function el(tag, props = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'style' && typeof v === 'string') e.style.cssText = v;
    else if (k === 'dataset') Object.assign(e.dataset, v);
    else if (k in e) e[k] = v;
    else e.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c != null) e.append(c);
  return e;
}
