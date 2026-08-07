// Vista Conversaciones — sesiones activas por canal.

import { api } from '../api.js';
import { esc, formatTime, channelBadge } from '../format.js';
import { openModal, bindActions } from '../ui.js';

export function createConversationsView(root) {
  async function openConversation(id) {
    try {
      const data = await api.getConversation(id);
      const s = data.session;
      openModal({
        title: 'Conversación',
        info:
          `<span><strong>Canal:</strong> ${esc(s.channel || '—')}</span>` +
          `<span><strong>Teléfono:</strong> ${esc(s.phone || '—')}</span>` +
          `<span><strong>ID:</strong> ${esc(s.id.substring(0, 8))}...</span>`,
        body: (data.messages || []).map(m =>
          `<div class="chat-msg ${m.role}"><div>${esc(m.content)}</div><div class="time">${formatTime(m.created_at)}</div></div>`
        ).join(''),
      });
    } catch {
      openModal({ title: 'Conversación', body: '<div class="empty">Error al cargar conversación</div>' });
    }
  }

  bindActions(root, {
    open: (data) => openConversation(data.id),
  });

  return {
    async render() {
      const convs = await api.getConversations();
      root.innerHTML = `
        <div class="panel-header">
          <div>
            <div class="panel-title">Conversaciones</div>
            <div class="panel-sub">Sesiones activas de todos los canales</div>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Canal</th><th>Contacto</th><th>Último mensaje</th><th>Mensajes</th><th>Última actividad</th></tr></thead>
            <tbody>
              ${convs.length === 0
                ? '<tr><td colspan="5" class="empty">Sin conversaciones activas</td></tr>'
                : convs.map(c => `
                  <tr>
                    <td>${channelBadge(c.channel)}</td>
                    <td class="clickable" data-action="open" data-id="${esc(c.id)}">${esc(c.phone || c.contact_id || 'Anónimo')}</td>
                    <td><div class="msg-preview">${esc(c.last_message || '—')}</div></td>
                    <td>${c.message_count || 0}</td>
                    <td>${formatTime(c.updated_at)}</td>
                  </tr>`).join('')}
            </tbody>
          </table>
        </div>`;
    },
  };
}
