// Vista Resumen — tarjetas con métricas globales.

import { api } from '../api.js';

export function createOverviewView(root) {
  return {
    async render() {
      const stats = await api.getStats();
      root.innerHTML = `
        <div class="cards">
          <div class="card">
            <div class="card-label">Total Conversaciones</div>
            <div class="card-num">${stats.total_sessions || 0}</div>
            <div class="card-sub">sesiones registradas</div>
          </div>
          <div class="card">
            <div class="card-label">Activas</div>
            <div class="card-num">${stats.active_sessions || 0}</div>
            <div class="card-sub">en curso ahora</div>
          </div>
          <div class="card">
            <div class="card-label">Leads Capturados</div>
            <div class="card-num">${stats.total_leads || 0}</div>
            <div class="card-sub">clientes potenciales</div>
          </div>
          <div class="card">
            <div class="card-label">Mensajes (24h)</div>
            <div class="card-num">${stats.messages_24h || 0}</div>
            <div class="card-sub">últimas 24 horas</div>
          </div>
        </div>
        <div class="table-wrap">
          <div style="padding:22px;display:flex;align-items:center;gap:16px">
            <div style="width:46px;height:46px;border-radius:12px;background:var(--bp-primary-soft);display:flex;align-items:center;justify-content:center;flex-shrink:0">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--bp-primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a10 10 0 0 1 10 10 4 4 0 0 1-4 4h-2a2 2 0 0 0-2 2v.5a2.5 2.5 0 0 1-2.5 2.5c-1.66 0-3-1.34-3-3V16a6 6 0 0 1 5.5-6z"/></svg>
            </div>
            <div>
              <div style="font-weight:600;font-size:15px">Panel de control</div>
              <div style="font-size:13px;color:var(--bp-text-secondary);margin-top:2px">Monitoreá conversaciones, handoffs, leads y clientes en tiempo real.</div>
            </div>
          </div>
        </div>`;
    },
  };
}
