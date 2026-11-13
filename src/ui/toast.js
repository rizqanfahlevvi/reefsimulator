/** Pesan singkat di atas tampilan 3D (mis. "Kabut 3D dinyalakan otomatis"). */
let node = null;
let timer = 0;

export function toast(msg, ms = 2800) {
  const view = document.getElementById('view');
  if (!view) return;
  if (!node) {
    node = document.createElement('div');
    node.className = 'toast';
    node.setAttribute('role', 'status');
    node.setAttribute('aria-live', 'polite');
    view.append(node);
  }
  node.textContent = msg;
  node.classList.add('show');
  clearTimeout(timer);
  timer = setTimeout(() => node.classList.remove('show'), ms);
}
