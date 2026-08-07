// Vista Leads — clientes potenciales capturados por el bot.

import { api } from '../api.js';
import { esc, formatTime } from '../format.js';

export function createLeadsView(root) {
  return {
    async render() {
      const leads = await api.getLeads();
      root.innerHTML = `
        <div class="panel-header">
          <div>
            <div class="panel-title">Leads</div>
            <div class="panel-sub">Contactos capturados y registrados en el CRM</div>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Nombre</th><th>Email</th><th>Teléfono</th><th>HubSpot ID</th><th>Última interacción</th></tr></thead>
            <tbody>
              ${leads.length === 0
                ? '<tr><td colspan="5" class="empty">Sin leads capturados</td></tr>'
                : leads.map(l => `
                  <tr>
                    <td class="cell-strong">${esc(l.name) || '—'}</td>
                    <td>${esc(l.email) || '—'}</td>
                    <td>${esc(l.phone) || '—'}</td>
                    <td class="cell-muted">${esc(l.hubspot_id) || '—'}</td>
                    <td>${l.last_interaction ? formatTime(l.last_interaction) : '—'}</td>
                  </tr>`).join('')}
            </tbody>
          </table>
        </div>`;
    },
  };
}
