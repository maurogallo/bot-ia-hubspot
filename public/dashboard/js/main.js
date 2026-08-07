// Composición raíz (app shell del dashboard).
// Registra el router de sidebar, inyecta las vistas y controla el polling.

import { initUi, toast } from './ui.js';
import { createOverviewView } from './views/overview.js';
import { createConversationsView } from './views/conversations.js';
import { createHandoffsView } from './views/handoffs.js';
import { createLeadsView } from './views/leads.js';
import { createClientsView } from './views/clients.js';
import { createAppointmentsView } from './views/appointments.js';

const POLL_INTERVAL = 5000;

const VIEWS = {
  overview: createOverviewView,
  conversations: createConversationsView,
  handoffs: createHandoffsView,
  leads: createLeadsView,
  clients: createClientsView,
  appointments: createAppointmentsView,
};

const TITLES = {
  overview: 'Resumen',
  conversations: 'Conversaciones',
  handoffs: 'Handoffs',
  leads: 'Leads',
  clients: 'Chatbots',
  appointments: 'Citas',
};

let views = {};
let activeView = 'overview';
let pollTimer = null;

const $ = (id) => document.getElementById(id);

function switchView(name) {
  if (!VIEWS[name]) return;
  activeView = name;

  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === name));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.dataset.view === name));
  $('pageTitle').textContent = TITLES[name];

  const view = views[name];
  if (view) refreshView(view);
}

async function refreshView(view) {
  const section = $('view-' + (Object.keys(views).find(k => views[k] === view) || activeView));
  try {
    await view.render();
    updateStatus(true, true);
  } catch {
    updateStatus(false, false);
  }
  $('lastUpdate').textContent = new Date().toLocaleTimeString('es-ES');
}

function updateStatus(ollama, db) {
  $('dot-ollama').className = 'status-dot ' + (ollama ? 'on' : 'off');
  $('dot-db').className = 'status-dot ' + (db ? 'on' : 'off');
}

function init() {
  initUi(document.getElementById('modalRoot'));

  // Crear todas las vistas pero solo renderizar la activa.
  Object.entries(VIEWS).forEach(([name, factory]) => {
    const section = $('view-' + name);
    if (!section) return;
    views[name] = factory(section);
  });

  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => switchView(item.dataset.view));
  });

  $('refreshBtn').addEventListener('click', () => {
    Object.values(views).forEach(v => refreshView(v));
  });

  switchView('overview');

  pollTimer = setInterval(() => {
    const view = views[activeView];
    if (view) refreshView(view);
  }, POLL_INTERVAL);
}

document.addEventListener('DOMContentLoaded', init);
