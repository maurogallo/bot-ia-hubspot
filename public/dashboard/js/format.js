// Helpers puros (dominio) — sin acceso al DOM, fáciles de testear.

export function esc(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}

export function formatTime(d) {
  if (!d) return '—';
  const date = new Date(d);
  const diff = Date.now() - date.getTime();
  if (diff < 60000) return 'Ahora';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h';
  return date.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function formatDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function channelBadge(channel) {
  const map = { whatsapp: 'badge-whatsapp', telegram: 'badge-telegram', web: 'badge-web' };
  const labels = { whatsapp: 'WhatsApp', telegram: 'Telegram', web: 'Web' };
  const cls = map[channel] || 'badge-web';
  const label = labels[channel] || (channel || 'Web');
  return `<span class="badge ${cls}">${esc(label)}</span>`;
}

export function planBadge(plan) {
  const cls = 'badge badge-' + (plan || 'starter');
  return `<span class="${cls}">${esc((plan || 'starter').toUpperCase())}</span>`;
}

export function statusBadge(status) {
  const s = status || 'pending';
  const cls = 'badge badge-' + s.toLowerCase().replace(/ /g, '-');
  return `<span class="${cls}">${esc(s)}</span>`;
}

export function quotaBar(used, limit) {
  if (limit === -1) return '<span class="cell-muted" style="color:#16a34a;font-weight:600">Ilimitado</span>';
  const pct = Math.min(100, Math.round((used / limit) * 100));
  const color = pct > 90 ? '#dc2626' : pct > 70 ? '#b45309' : '#16a34a';
  return `<div class="quota"><div class="quota-track"><div class="quota-fill" style="width:${pct}%;background:${color}"></div></div><span class="quota-num">${used}/${limit}</span></div>`;
}

export function featureTags(features) {
  const defs = [
    { key: 'chat', label: 'Chat', cls: 'green' },
    { key: 'scheduling', label: 'Agendamiento', cls: '' },
    { key: 'crm', label: 'CRM', cls: 'yellow' },
    { key: 'knowledgeBase', label: 'Knowledge Base', cls: 'purple' },
    { key: 'api', label: 'API', cls: 'red' },
    { key: 'support', label: 'Soporte dedicado', cls: 'orange' },
  ];
  return defs.filter(f => features && features[f.key]).map(f => `<span class="feature-tag ${f.cls}">${f.label}</span>`).join('');
}
