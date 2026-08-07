// Adapter de salida (HTTP) — única capa que conoce `fetch` y las rutas REST del backend.
// Las vistas dependen de esta interfaz, no de detalles HTTP.

async function request(path, options = {}) {
  const res = options.body !== undefined
    ? await fetch(path, { ...options, headers: { 'Content-Type': 'application/json' } })
    : await fetch(path, options);
  if (!res.ok) {
    let detail;
    try { detail = (await res.json()).error; } catch { /* ignore */ }
    throw new Error(detail || res.statusText || `Error ${res.status}`);
  }
  return res.json();
}

function postJson(path, body) {
  return request(path, { method: 'POST', body: JSON.stringify(body) });
}

function putJson(path, body) {
  return request(path, { method: 'PUT', body: JSON.stringify(body) });
}

export const api = {
  // Dashboard
  getStats: () => request('/api/dashboard/stats'),
  getConversations: () => request('/api/dashboard/conversations'),
  getConversation: (id) => request(`/api/dashboard/conversations/${id}`),
  getHandoffs: () => request('/api/dashboard/handoffs'),
  assignHandoff: (id) => postJson(`/api/dashboard/handoffs/${id}/assign`, { assignedTo: 'Agente' }),
  getLeads: () => request('/api/dashboard/leads'),

  // Tenants / clientes
  getTenants: () => request('/api/tenants'),
  getTenant: (slug) => request(`/api/tenants/${slug}`),
  createTenant: (body) => postJson('/api/tenants', body),
  updateTenant: (slug, body) => putJson(`/api/tenants/${slug}`, body),
  deactivateTenant: (slug) => request(`/api/tenants/${slug}`, { method: 'DELETE' }),
  getTenantUsage: (slug) => request(`/api/tenants/${slug}/usage`),
  getTemplates: () => request('/api/templates'),

  // Servicios del tenant
  getTenantServices: (slug) => request(`/api/tenants/${slug}/services`),
  addTenantService: (slug, body) => postJson(`/api/tenants/${slug}/services`, body),
  deleteTenantService: (slug, id) => request(`/api/tenants/${slug}/services/${id}`, { method: 'DELETE' }),

  // Citas
  getAppointments: () => request('/api/appointments'),
  cancelAppointment: (id) => request(`/api/appointments/${id}`, { method: 'DELETE' }),
};
