// Vista Citas — citas agendadas vía Google Calendar.

import { api } from '../api.js';
import { esc, formatDateTime, statusBadge } from '../format.js';
import { confirmDialog, bindActions, toast } from '../ui.js';

export function createAppointmentsView(root) {
  async function cancel(id) {
    if (!confirmDialog('Cancelar esta cita?')) return;
    try {
      await api.cancelAppointment(id);
      toast('Cita cancelada', 'success');
      await load();
    } catch {
      toast('Error al cancelar cita', 'error');
    }
  }

  async function load() {
    const apps = await api.getAppointments();
    root.innerHTML = `
      <div class="panel-header">
        <div>
          <div class="panel-title">Citas</div>
          <div class="panel-sub">Agendamientos confirmados vía Google Calendar</div>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Cliente</th><th>Email</th><th>Servicio</th><th>Fecha</th><th>Estado</th><th>Acciones</th></tr></thead>
          <tbody>
            ${apps.length === 0
              ? '<tr><td colspan="6" class="empty">Sin citas agendadas</td></tr>'
              : apps.map(a => `
                  <tr>
                    <td class="cell-strong">${esc(a.contact_name) || '—'}</td>
                    <td>${esc(a.contact_email)}</td>
                    <td>${esc(a.service_interest) || '—'}</td>
                    <td>${a.start_time ? formatDateTime(a.start_time) : '—'}</td>
                    <td>${statusBadge(a.status)}</td>
                    <td>${a.status === 'confirmed'
                      ? `<button class="btn btn-danger btn-sm" data-action="cancel" data-id="${esc(a.id)}">Cancelar</button>`
                      : ''}</td>
                  </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  }

  bindActions(root, {
    cancel: (data) => cancel(data.id),
  });

  return { render: load };
}
