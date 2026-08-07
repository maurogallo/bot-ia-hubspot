// Componentes UI reutilizables (adapter de salida al DOM).

let modalRoot = null;

export function initUi(root) {
  modalRoot = root;
}

export function openModal({ title, info = '', body = '', onBodyMount }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header"><h2>${title}</h2><button class="modal-close" aria-label="Cerrar">×</button></div>
      ${info ? `<div class="modal-info">${info}</div>` : ''}
      <div class="modal-body"></div>
    </div>`;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
  overlay.querySelector('.modal-close').addEventListener('click', closeModal);
  const bodyEl = overlay.querySelector('.modal-body');
  if (typeof body === 'string') bodyEl.innerHTML = body;
  else bodyEl.appendChild(body);
  (modalRoot || document.body).appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));
  if (onBodyMount) onBodyMount(overlay, bodyEl);
  return { overlay, bodyEl };
}

export function closeModal() {
  document.querySelectorAll('.modal-overlay.open').forEach(o => o.remove());
}

export function confirmDialog(message) {
  return window.confirm(message);
}

// Delegación de eventos: el contenedor escucha clicks en elementos [data-action].
// Las vistas registran { action: handler } una sola vez; el innerHTML puede re-renderizarse.
export function bindActions(root, handlers) {
  root.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || !root.contains(el)) return;
    const { action } = el.dataset;
    const fn = handlers[action];
    if (fn) fn(el.dataset, el, e);
  });
}

export function toast(message, type = '') {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = document.createElement('div');
  t.className = 'toast' + (type ? ' ' + type : '');
  t.textContent = message;
  document.body.appendChild(t);
  setTimeout(() => { t.remove(); }, 3200);
}
