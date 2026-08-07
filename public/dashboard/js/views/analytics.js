// Vista Analíticas — métricas de conversión, canales y funnel.
// Barras simples con CSS (sin librerías de charts).

import { api } from '../api.js';
import { esc } from '../format.js';
import { bindActions } from '../ui.js';

const CHANNEL_LABELS = { whatsapp: 'WhatsApp', web: 'Web', telegram: 'Telegram' };

export function createAnalyticsView(root) {
  let state = { days: 30 };

  function channelLabel(ch) {
    return CHANNEL_LABELS[ch] || (ch || 'Otro');
  }

  function kpiCards(d) {
    return `
      <div class="cards">
        <div class="card">
          <div class="card-label">Conversaciones</div>
          <div class="card-num">${d.conversations}</div>
          <div class="card-sub">en los últimos ${state.days} días</div>
        </div>
        <div class="card">
          <div class="card-label">Mensajes</div>
          <div class="card-num">${d.messages}</div>
          <div class="card-sub">en el período</div>
        </div>
        <div class="card">
          <div class="card-label">Leads Capturados</div>
          <div class="card-num">${d.leads}</div>
          <div class="card-sub">${d.conversionRate}% de conversión</div>
        </div>
        <div class="card">
          <div class="card-label">Citas Agendadas</div>
          <div class="card-num">${d.appointments}</div>
          <div class="card-sub">${d.handoffs} handoffs a humano</div>
        </div>
      </div>`;
  }

  function rangeSelector() {
    const options = [7, 30, 90].map(d =>
      `<button class="btn ${d === state.days ? 'btn-primary' : 'btn-secondary'} btn-sm" data-action="range" data-days="${d}">${d} días</button>`
    ).join(' ');
    return `
      <div class="panel-header">
        <div>
          <div class="panel-title">Analíticas</div>
          <div class="panel-sub">Conversión, canales y funnel de ventas</div>
        </div>
        <div style="display:flex;gap:8px">${options}</div>
      </div>`;
  }

  function channelBars(byChannel, maxConversations) {
    if (!byChannel.length) return '<div class="empty">Sin conversaciones en el período</div>';
    const rows = byChannel.map(c => {
      const width = maxConversations > 0 ? Math.round((c.conversations / maxConversations) * 100) : 0;
      const leadPct = c.conversations > 0 ? Math.round((c.leads / c.conversations) * 100) : 0;
      return `
        <div style="margin-bottom:18px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <span style="font-weight:600;font-size:14px">${esc(channelLabel(c.channel))}</span>
            <span style="font-size:13px;color:var(--bp-text-secondary)">${c.conversations} conv · ${c.leads} leads · ${leadPct}%</span>
          </div>
          <div class="quota-track" style="height:10px">
            <div class="quota-fill" style="width:${width}%;background:var(--bp-primary)"></div>
          </div>
        </div>`;
    });
    return rows.join('');
  }

  function funnelBar(label, value, pct) {
    return `
      <div style="margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <span style="font-weight:600;font-size:14px">${esc(label)}</span>
          <span style="font-size:13px;color:var(--bp-text-secondary)">${value}${pct != null ? ` · ${pct}%` : ''}</span>
        </div>
        <div class="quota-track" style="height:10px">
          <div class="quota-fill" style="width:${pct == null ? 100 : Math.max(2, Math.min(100, pct))}%;background:var(--bp-primary)"></div>
        </div>
      </div>`;
  }

  function timelineChart(timeline) {
    const max = Math.max(1, ...timeline.map(t => t.conversations));
    const cells = timeline.map(t => {
      const h = t.conversations > 0 ? Math.round((t.conversations / max) * 120) : 2;
      const d = new Date(t.date + 'T00:00:00');
      const label = d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' });
      return `
        <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:6px;min-width:18px">
          <span style="font-size:11px;color:var(--bp-text-muted)">${t.conversations}</span>
          <div style="width:16px;height:${h}px;background:var(--bp-primary);border-radius:4px 4px 0 0"></div>
          <span style="font-size:10px;color:var(--bp-text-muted)">${label}</span>
        </div>`;
    }).join('');
    return `
      <div style="display:flex;gap:4px;align-items:flex-end;padding-top:8px;overflow-x:auto">
        ${cells}
      </div>`;
  }

  async function load() {
    const data = await api.getAnalytics(state.days);
    const maxChannel = Math.max(1, ...data.byChannel.map(c => c.conversations));
    const funnel = data.funnel;
    const funnelSteps = [
      { label: 'Conversaciones iniciadas', value: funnel.totalConversations, pct: 100 },
      { label: 'Leads con email', value: funnel.leadsWithEmail, pct: funnel.totalConversations > 0 ? Math.round((funnel.leadsWithEmail / funnel.totalConversations) * 100) : 0 },
      { label: 'Contactos en CRM', value: funnel.contacts, pct: funnel.leadsWithEmail > 0 ? Math.round((funnel.contacts / funnel.leadsWithEmail) * 100) : 0 },
      { label: 'Citas agendadas', value: funnel.appointments, pct: funnel.contacts > 0 ? Math.round((funnel.appointments / funnel.contacts) * 100) : 0 },
      { label: 'Handoffs a humano', value: funnel.handoffs, pct: funnel.contacts > 0 ? Math.round((funnel.handoffs / funnel.contacts) * 100) : 0 },
    ];

    root.innerHTML = `
      ${rangeSelector()}
      ${kpiCards(data.kpis)}
      <div class="cards">
        <div class="card">
          <div class="card-label" style="margin-bottom:14px">Conversaciones por canal</div>
          ${channelBars(data.byChannel, maxChannel)}
        </div>
        <div class="card">
          <div class="card-label" style="margin-bottom:14px">Funnel de conversión</div>
          ${funnelSteps.map(s => funnelBar(s.label, s.value, s.pct)).join('')}
        </div>
      </div>
      <div class="table-wrap">
        <div style="padding:22px">
          <div class="card-label" style="margin-bottom:16px">Conversaciones por día</div>
          ${timelineChart(data.timeline)}
        </div>
      </div>`;
  }

  bindActions(root, {
    range: (data) => {
      state.days = parseInt(data.days, 10) || 30;
      load().catch(() => {});
    },
  });

  return { render: load };
}
