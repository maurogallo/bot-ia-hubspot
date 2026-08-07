// Vista Handoffs — sesiones derivadas a un agente humano.

import { api } from '../api.js';
import { esc, formatTime, channelBadge } from '../format.js';
import { openModal, bindActions, toast } from '../ui.js';

export function createHandoffsView(root) {
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

  async function assign(id) {
    try {
      await api.assignHandoff(id);
      toast('Handoff asignado', 'success');
      await render();
    } catch {
      toast('Error al asignar handoff', 'error');
    }
  }

  const view = { async render() { await load(); } };

  async function load() {
    const handoffs = await api.getHandoffs();
    root.innerHTML = `
      <div class="panel-header">
        <div>
          <div class="panel-title">Handoffs</div>
          <div class="panel-sub">Conversaciones que requieren atención humana</div>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Canal</th><th>Contacto</th><th>Motivo</th><th>Confianza</th><th>Mensajes</th><th>Última actividad</th><th>Acción</th></tr></thead>
          <tbody>
            ${handoffs.length === 0
              ? '<tr><td colspan="7" class="empty">Sin handoffs pendientes</td></tr>'
              : handoffs.map(h => {
                  const ctx = h.context || {};
                  return `
                    <tr>
                      <td>${channelBadge(h.channel)}</td>
                      <td class="clickable" data-action="open" data-id="${esc(h.id)}">${esc(h.phone || h.contact_id || 'Anónimo')}</td>
                      <td>${esc(ctx.handoffReason || '—')}</td>
                      <td>${ctx.handoffConfidence ? Math.round(ctx.handoffConfidence * 100) + '%' : '—'}</td>
                      <td>${h.message_count || 0}</td>
                      <td>${formatTime(h.updated_at)}</td>
                      <td><button class="btn btn-primary btn-sm" data-action="assign" data-id="${esc(h.id)}">Asignarme</button></td>
                    </tr>`;
                }).join('')}
          </tbody>
        </table>
      </div>`;
  }

  bindActions(root, {
    open: (data) => openConversation(data.id),
    assign: (data) => assign(data.id),
  });

  return view;
}
