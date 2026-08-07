// Vista Clientes (AI Agents) — tabla + wizard "Create Chatbot" estilo BotPenguin.
// Flujo: Select Platform → Usecase → Setup Bot → Install Bot.

import { api } from '../api.js';
import { esc, planBadge, quotaBar } from '../format.js';
import { openModal, closeModal, confirmDialog, bindActions, toast } from '../ui.js';

let currentTenant = null;
let wizard = null;
let wizardServices = [];

const WIDGET_BASE = 'https://bot.synaptiqnova.online/widget.js';

// Plataformas soportadas (las no soportadas salen como "Próximamente").
const PLATFORMS = [
  { id: 'web', icon: '🌐', name: 'Website / Mobile App', desc: 'Agregá un chatbot a tu web o app e interactuá con visitantes al instante.', supported: true },
  { id: 'whatsapp', icon: '💬', name: 'WhatsApp', desc: 'Automatizá conversaciones, enviá alertas y chateá usando WhatsApp.', supported: true },
  { id: 'telegram', icon: '✈️', name: 'Telegram', desc: 'Construí conversaciones rápidas y seguras dentro de Telegram.', supported: true },
  { id: 'instagram', icon: '📸', name: 'Instagram', desc: 'Respondé DMs, comentarios y stories automáticamente.', supported: false },
  { id: 'facebook', icon: '👍', name: 'Facebook', desc: 'Conectate mediante conversaciones automatizadas en Messenger.', supported: false },
  { id: 'msteams', icon: '🧊', name: 'MS Teams', desc: 'Soportá empleados y automatizá tareas internas en Microsoft Teams.', supported: false },
  { id: 'sms', icon: '📱', name: 'SMS / Text Messaging', desc: 'Entregá actualizaciones instantáneas mediante simples chats SMS.', supported: false },
];

export function createClientsView(root) {
  async function copyWidget(slug, businessName) {
    try {
      await navigator.clipboard.writeText(
        `<script src="${WIDGET_BASE}" data-tenant="${slug}" data-primary="#226cf4"><\/script>`
      );
      toast(`Código copiado. Pegalo antes de </body> en ${businessName}`, 'success');
    } catch {
      openModal({
        title: 'Código del widget',
        body: `<div class="info-box" style="font-family:monospace;font-size:13px;word-break:break-all">&lt;script src="${WIDGET_BASE}" data-tenant="${esc(slug)}" data-primary="#226cf4"&gt;&lt;/script&gt;</div>` +
              `<p style="font-size:13px;color:var(--bp-text-secondary)">Copialo manualmente y pegalo antes de &lt;/body&gt; en el sitio de ${esc(businessName)}.</p>`,
      });
    }
  }

  async function editAgent(slug) {
    try {
      const t = await api.getTenant(slug);
      openEditAgent(t);
    } catch {
      toast('Error al cargar agente', 'error');
    }
  }

  async function deleteAgent(slug) {
    if (!confirmDialog(`Desactivar chatbot ${slug}?`)) return;
    try {
      await api.deactivateTenant(slug);
      toast('Chatbot desactivado', 'success');
      await load();
    } catch {
      toast('Error al desactivar chatbot', 'error');
    }
  }

  async function servicesStep(slug) {
    try {
      const services = await api.getTenantServices(slug);
      openModal({
        title: `Servicios — ${slug}`,
        body: `
          <p class="panel-sub" style="margin-bottom:12px">Define los servicios de este chatbot. El agente los usará para recomendar.</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
            <input id="ss-name" placeholder="Nombre del servicio" style="flex:1;min-width:140px">
            <input id="ss-price" placeholder="Precio" style="width:100px" type="number">
            <input id="ss-label" placeholder="USD" style="width:70px">
            <input id="ss-desc" placeholder="Descripción (opcional)" style="width:180px">
          </div>
          <button class="btn btn-primary btn-sm" data-action="add-service" style="margin-bottom:12px">+ Agregar Servicio</button>
          <div id="svc-list">${renderServiceList(services)}</div>
          <div class="form-actions">
            <button class="btn btn-primary" data-action="services-done">Listo</button>
          </div>`,
        onBodyMount: (overlay, bodyEl) => {
          bindActions(bodyEl, {
            'add-service': async () => {
              const name = document.getElementById('ss-name').value.trim();
              if (!name) { toast('Nombre es obligatorio', 'error'); return; }
              await api.addTenantService(slug, {
                name,
                price: document.getElementById('ss-price').value ? parseFloat(document.getElementById('ss-price').value) : null,
                priceLabel: document.getElementById('ss-label').value || 'USD',
                description: document.getElementById('ss-desc').value,
              });
              const svcs = await api.getTenantServices(slug);
              document.getElementById('svc-list').innerHTML = renderServiceList(svcs);
            },
            'services-done': () => { closeModal(); load(); },
          });
          // Eliminación de servicios vía delegación en el overlay
          overlay.addEventListener('click', async (e) => {
            const btn = e.target.closest('[data-del-service]');
            if (!btn) return;
            await api.deleteTenantService(slug, btn.dataset.id);
            const svcs = await api.getTenantServices(slug);
            document.getElementById('svc-list').innerHTML = renderServiceList(svcs);
          });
        },
      });
    } catch {
      toast('Error al cargar servicios', 'error');
    }
  }

  function renderServiceList(services) {
    if (!services || services.length === 0) {
      return '<div class="empty">Sin servicios definidos. Agrega al menos uno.</div>';
    }
    return services.map(s => `
      <div class="svc-item">
        <span class="name">${esc(s.name)}</span>
        <span class="desc">${s.description ? esc(s.description) : ''}</span>
        <span class="price">${s.price ? '$' + s.price + ' ' + esc(s.price_label || 'USD') : 'Consultar'}</span>
        <button class="svc-remove" data-del-service data-id="${esc(s.id)}">×</button>
      </div>`).join('');
  }

  async function load() {
    const tenants = await api.getTenants();
    const usages = {};
    for (const t of tenants) {
      try { usages[t.slug] = await api.getTenantUsage(t.slug); } catch { /* ignore */ }
    }
    root.innerHTML = `
      <div class="panel-header">
        <div>
          <div class="panel-title">Chatbots (AI Agents)</div>
          <div class="panel-sub">Agentes conversacionales por plataforma y negocio</div>
        </div>
        <button class="btn btn-primary" data-action="new-agent">+ Crear Chatbot</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Chatbot</th><th>Negocio</th><th>Plataforma</th><th>Plan</th><th>Uso (Conversaciones)</th><th>Estado</th><th>Acciones</th></tr></thead>
          <tbody>
            ${tenants.length === 0
              ? '<tr><td colspan="7" class="empty">Sin chatbots. Creá el primero con "+ Crear Chatbot"</td></tr>'
              : tenants.map(t => {
                  const u = usages[t.slug] || {};
                  const used = u.conversations || 0;
                  const limit = t.plan === 'starter' ? 100 : t.plan === 'business' ? 500 : -1;
                  const platform = platformOfTenant(t);
                  return `
                    <tr>
                      <td class="cell-strong">${esc(t.slug)}</td>
                      <td>${esc(t.business_name)}</td>
                      <td>${platform}</td>
                      <td>${planBadge(t.plan)}</td>
                      <td>${quotaBar(used, limit)}</td>
                      <td>${t.is_active
                        ? '<span style="color:var(--bp-success);font-weight:600">Activo</span>'
                        : '<span style="color:var(--bp-danger);font-weight:600">Inactivo</span>'}</td>
                      <td style="white-space:nowrap">
                        <button class="btn btn-success btn-sm" data-action="widget" data-slug="${esc(t.slug)}" data-name="${esc(t.business_name)}" title="Copiar widget">&lt;/&gt;</button>
                        <button class="btn btn-secondary btn-sm" data-action="edit" data-slug="${esc(t.slug)}">Editar</button>
                        <button class="btn btn-danger btn-sm" data-action="delete" data-slug="${esc(t.slug)}">X</button>
                      </td>
                    </tr>`;
                }).join('')}
          </tbody>
        </table>
      </div>`;
  }

  bindActions(root, {
    'new-agent': () => startCreateWizard(),
    widget: (data) => copyWidget(data.slug, data.name),
    edit: (data) => editAgent(data.slug),
    delete: (data) => deleteAgent(data.slug),
  });

  // Permite que el wizard cierre desde la lista de servicios tras guardar
  window.addEventListener('agents-changed', load);

  return { render: load };
}

function platformOfTenant(t) {
  const f = t.features || {};
  if (f.whatsapp) return '<span class="badge badge-whatsapp">WhatsApp</span>';
  if (f.webChat) return '<span class="badge badge-web">Web</span>';
  const channels = t.channels || [];
  if (channels.includes('telegram')) return '<span class="badge badge-telegram">Telegram</span>';
  return '<span class="badge badge-web">Web</span>';
}

// ---------- Wizard: Create Chatbot ----------

const FEATURES = {
  starter: { chat: true, scheduling: true, crm: false, knowledgeBase: false, api: false, conv: '100/mes' },
  business: { chat: true, scheduling: true, crm: true, knowledgeBase: true, api: false, conv: '500/mes' },
  pro: { chat: true, scheduling: true, crm: true, knowledgeBase: true, api: true, conv: 'Ilimitadas' },
  enterprise: { chat: true, scheduling: true, crm: true, knowledgeBase: true, api: true, support: true, conv: 'Ilimitadas' },
};

function renderStepBar(active) {
  const steps = ['Select Platform', 'Usecase', 'Setup Bot', 'Install Bot'];
  return `<div class="steps">${steps.map((s, i) => {
    const n = i + 1;
    const cls = n === active ? 'active' : n < active ? 'done' : '';
    return `<span class="step ${cls}">${s}</span>`;
  }).join('')}</div>`;
}

function wizardShell(active, content) {
  return `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">
      <span class="clickable" data-action="wizard-close" style="display:inline-flex;align-items:center;gap:4px">← Atrás</span>
      <span class="wizard-title" style="flex:1">Create Chatbot</span>
      <span class="cell-muted">${active}/4</span>
    </div>
    ${renderStepBar(active)}
    ${content}`;
}

// ---- Paso 1: Select Platform ----

function startCreateWizard() {
  wizard = { platform: null, usecase: null, templateData: null, features: {} };
  wizardServices = [];
  openModal({
    title: '',
    body: wizardShell(1, `
      <div class="wizard-title">Select Platform</div>
      <div class="wizard-sub">Cada plataforma ofrece funciones únicas, esto nos ayuda a personalizar la creación de tu bot.</div>
      <div class="platform-grid">
        ${PLATFORMS.map(p => `
          <button class="platform-card ${p.supported ? '' : 'disabled'}" data-action="pick-platform" data-id="${p.id}">
            <div class="platform-icon">${p.icon}</div>
            <div style="flex:1">
              <div class="platform-name">${esc(p.name)} ${p.supported ? '' : '<span class="platform-soon">Próximamente</span>'}</div>
              <div class="platform-desc">${esc(p.desc)}</div>
            </div>
          </button>`).join('')}
      </div>`),
    onBodyMount: (overlay, bodyEl) => {
      bindActions(bodyEl, {
        'wizard-close': () => closeModal(),
        'pick-platform': (data, el) => {
          if (el.classList.contains('disabled')) return;
          bodyEl.querySelectorAll('.platform-card').forEach(c => c.classList.remove('selected'));
          el.classList.add('selected');
          wizard.platform = data.id;
          step2Usecase(bodyEl);
        },
      });
    },
  });
}

// ---- Paso 2: Usecase ----

async function step2Usecase(scope) {
  let templates = [];
  try { templates = await api.getTemplates(); } catch { /* ignore */ }
  openModal({
    title: '',
    body: wizardShell(2, `
      <div class="wizard-title">Select Usecase</div>
      <div class="wizard-sub">Elegí un caso de uso para pre-configurar el conocimiento del agente.</div>
      <div class="platform-grid">
        <button class="platform-card" data-action="pick-usecase" data-id="custom">
          <div class="platform-icon">⚙️</div>
          <div style="flex:1">
            <div class="platform-name">Personalizado</div>
            <div class="platform-desc">Empezá desde cero, vos definís servicios y conocimiento.</div>
          </div>
        </button>
        ${templates.map(t => `
          <button class="platform-card" data-action="pick-usecase" data-id="${esc(t.name)}" data-name="${esc(t.name + ' - ' + t.description)}" data-desc="${esc(t.description)}">
            <div class="platform-icon">${esc(t.icon || '📦')}</div>
            <div style="flex:1">
              <div class="platform-name">${esc(t.name)}</div>
              <div class="platform-desc">${esc(t.description)}</div>
            </div>
          </button>`).join('')}
      </div>`),
    onBodyMount: (overlay, bodyEl) => {
      bindActions(bodyEl, {
        'wizard-close': () => startCreateWizard(),
        'pick-usecase': (data) => {
          wizard.usecase = data.id;
          wizard.templateData = data.id === 'custom' ? null : { name: data.id };
          step3SetupBot(bodyEl);
        },
      });
    },
  });
}

// ---- Paso 3: Setup Bot ----

function step3SetupBot(scope) {
  openModal({
    title: '',
    body: wizardShell(3, `
      <div class="wizard-title">Setup Bot</div>
      <div class="wizard-sub">Configurá los datos de negocio del agente. Estos datos lo usará para vender y atender.</div>
      <div class="form-group"><label>Nombre del Negocio *</label>
        <input id="b-name" placeholder="Clinica San Jose"></div>
      <div class="form-group"><label>Slug (identificador único) *</label>
        <input id="b-slug" placeholder="clinica-san-jose"></div>
      <div class="form-group"><label>Descripción de servicios</label>
        <input id="b-services" placeholder="Consultas médicas, tratamientos, emergencias"></div>
      <div class="form-group"><label>Plan</label>
        <select id="b-plan">
          <option value="starter">Starter - Chat + Agendamiento (100 conv/mes)</option>
          <option value="business">Business - Chat + Agendamiento + CRM (500 conv/mes)</option>
          <option value="pro" selected>Pro - Ilimitado + API + Analytics</option>
          <option value="enterprise">Enterprise - Todo + Soporte + Onboarding</option>
        </select></div>
      <div class="form-group"><label>WhatsApp (número, opcional)</label>
        <input id="b-wa" placeholder="+54911..."></div>
      <div class="form-group"><label>Nombre del Dueño</label>
        <input id="b-owner" placeholder="Dr. Juan Perez"></div>
      <div class="form-group"><label>Email del Dueño</label>
        <input id="b-owner-email" placeholder="juan@clinicasanjose.com"></div>
      <div class="form-actions">
        <button class="btn btn-secondary" data-action="wizard-back2">Atrás</button>
        <button class="btn btn-primary" data-action="wizard-next3">Continuar »</button>
      </div>`),
    onBodyMount: (overlay, bodyEl) => {
      const slugInput = bodyEl.querySelector('#b-slug');
      const nameInput = bodyEl.querySelector('#b-name');
      nameInput.addEventListener('input', () => {
        if (!slugInput.dataset.touched) {
          slugInput.value = nameInput.value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        }
      });
      slugInput.addEventListener('input', () => { slugInput.dataset.touched = '1'; });
      bindActions(bodyEl, {
        'wizard-close': () => step2Usecase(bodyEl),
        'wizard-back2': () => step2Usecase(bodyEl),
        'wizard-next3': () => step4Install(bodyEl),
      });
    },
  });
}

// ---- Paso 4: Install Bot ----

function step4Install(scope) {
  const name = scope.querySelector('#b-name').value.trim();
  const slug = scope.querySelector('#b-slug').value.trim();
  const services = scope.querySelector('#b-services').value;
  const plan = scope.querySelector('#b-plan').value;
  const wa = scope.querySelector('#b-wa').value;
  const owner = scope.querySelector('#b-owner').value;
  const ownerEmail = scope.querySelector('#b-owner-email').value;

  if (!name || !slug) { toast('Nombre y Slug son obligatorios', 'error'); return; }

  wizard.bot = { name, slug, services, plan, wa, owner, ownerEmail };

  // Features según plataforma + plan
  wizard.features = { whatsapp: wizard.platform === 'whatsapp', webChat: wizard.platform === 'web', telegram: wizard.platform === 'telegram' };
  if (plan !== 'starter') { wizard.features.scheduling = true; wizard.features.crm = true; wizard.features.knowledgeBase = true; }

  const widgetCode = `<script src="${WIDGET_BASE}" data-tenant="${esc(slug)}" data-primary="#226cf4"><\/script>`;

  const installBody = wizard.platform === 'web'
    ? `
      <div class="wizard-title">Install Bot</div>
      <div class="wizard-sub">Agregá este código antes de &lt;/body&gt; en tu sitio web.</div>
      <div class="info-box" style="font-family:monospace;font-size:13px;word-break:break-all">${widgetCode}</div>
      <button class="btn btn-primary btn-sm" data-action="copy-widget">Copiar código</button>`
    : wizard.platform === 'whatsapp'
      ? `
      <div class="wizard-title">Install Bot</div>
      <div class="wizard-sub">El agente responde en tu número de WhatsApp ${wa ? esc(wa) : 'configurado'}.</div>
      <div class="info-box">WhatsApp se conecta vía API de Meta. La activación se completa cuando el número esté verificado.</div>`
      : `
      <div class="wizard-title">Install Bot</div>
      <div class="wizard-sub">Telegram se activa automáticamente al crear el agente.</div>
      <div class="info-box">Tu agente responde en el bot de Telegram conectado al sistema.</div>`;

  openModal({
    title: '',
    body: wizardShell(4, installBody + `
      <div class="form-actions">
        <button class="btn btn-secondary" data-action="wizard-back3">Atrás</button>
        <button class="btn btn-success" data-action="wizard-create">Crear Chatbot</button>
      </div>`),
    onBodyMount: (overlay, bodyEl) => {
      bindActions(bodyEl, {
        'wizard-close': () => step3SetupBot(bodyEl),
        'wizard-back3': () => step3SetupBot(bodyEl),
        'copy-widget': async () => {
          try {
            await navigator.clipboard.writeText(`<script src="${WIDGET_BASE}" data-tenant="${slug}" data-primary="#226cf4"></script>`);
            toast('Código copiado', 'success');
          } catch { toast('No se pudo copiar', 'error'); }
        },
        'wizard-create': () => createAgent(bodyEl),
      });
    },
  });
}

async function createAgent(scope) {
  if (!wizard || !wizard.bot) return;
  const body = {
    slug: wizard.bot.slug,
    businessName: wizard.bot.name,
    businessServices: wizard.bot.services,
    template: wizard.templateData ? wizard.templateData.name : null,
    plan: wizard.bot.plan,
    whatsappPhone: wizard.bot.wa,
    ownerName: wizard.bot.owner,
    ownerEmail: wizard.bot.ownerEmail,
    features: wizard.features,
  };
  try {
    await api.createTenant(body);
    for (const svc of wizardServices) {
      await api.addTenantService(wizard.bot.slug, svc);
    }
    closeModal();
    toast('Chatbot creado', 'success');
    window.dispatchEvent(new CustomEvent('agents-changed'));
  } catch (e) {
    toast('Error al crear chatbot: ' + e.message, 'error');
  }
}

// ---------- Edición de agente existente ----------

function openEditAgent(tenant) {
  currentTenant = tenant;
  openModal({
    title: `Editar Chatbot: ${esc(tenant.business_name)}`,
    body: `
      <div class="form-group"><label>Slug</label><input id="f-slug" value="${esc(tenant.slug)}" readonly></div>
      <div class="form-group"><label>Nombre del Negocio</label><input id="f-name" value="${esc(tenant.business_name)}"></div>
      <div class="form-group"><label>Descripción de servicios</label><input id="f-services" value="${esc(tenant.business_services || '')}"></div>
      <div class="form-group"><label>Plan</label>
        <select id="f-plan">
          <option value="starter" ${tenant.plan === 'starter' ? 'selected' : ''}>Starter - Chat + Agendamiento (100 conv/mes)</option>
          <option value="business" ${tenant.plan === 'business' ? 'selected' : ''}>Business - Chat + Agendamiento + CRM (500 conv/mes)</option>
          <option value="pro" ${tenant.plan === 'pro' ? 'selected' : ''}>Pro - Ilimitado + API + Analytics</option>
          <option value="enterprise" ${tenant.plan === 'enterprise' ? 'selected' : ''}>Enterprise - Todo + Soporte + Onboarding</option>
        </select></div>
      <div class="form-group"><label>WhatsApp (número)</label><input id="f-wa" value="${esc(tenant.whatsapp_phone || '')}"></div>
      <div class="form-group"><label>Nombre del Dueño</label><input id="f-owner" value="${esc(tenant.owner_name || '')}"></div>
      <div class="form-group"><label>Email del Dueño</label><input id="f-owner-email" value="${esc(tenant.owner_email || '')}"></div>
      <div class="form-actions">
        <button class="btn btn-secondary" data-action="cancel-modal">Cancelar</button>
        <button class="btn btn-success" data-action="edit-services" data-slug="${esc(tenant.slug)}">Servicios</button>
        <button class="btn btn-primary" data-action="save-edit" data-slug="${esc(tenant.slug)}">Guardar</button>
      </div>`,
    onBodyMount: (overlay, bodyEl) => {
      bindActions(bodyEl, {
        'cancel-modal': () => closeModal(),
        'save-edit': (data) => saveAgent(data.slug, bodyEl),
        'edit-services': (data) => { closeModal(); servicesStep(data.slug); },
      });
    },
  });
}

async function saveAgent(slug, scope) {
  const body = {
    slug: scope.querySelector('#f-slug').value,
    businessName: scope.querySelector('#f-name').value.trim(),
    businessServices: scope.querySelector('#f-services').value,
    plan: scope.querySelector('#f-plan').value,
    whatsappPhone: scope.querySelector('#f-wa').value,
    ownerName: scope.querySelector('#f-owner').value,
    ownerEmail: scope.querySelector('#f-owner-email').value,
  };
  if (!body.slug || !body.businessName) { toast('Slug y Nombre son obligatorios', 'error'); return; }
  try {
    await api.updateTenant(slug, body);
    closeModal();
    toast('Chatbot actualizado', 'success');
    window.dispatchEvent(new CustomEvent('agents-changed'));
  } catch {
    toast('Error al guardar chatbot', 'error');
  }
}
