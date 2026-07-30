# Plan de Desarrollo — Arquitectura Multi-Tenant

## Objetivo

Una sola instancia del bot sirve a múltiples clientes del revendedor. Cada cliente tiene su plan, features, y configuración independiente. El revendedor administra todo desde un solo dashboard.

---

## Fase 1 — Tabla de tenants y plan-based features

### 1.1 Tabla `tenants` (PostgreSQL)

```sql
CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,              -- identificador único: "clinica-san-jose"
  business_name TEXT NOT NULL,            -- nombre del negocio del cliente
  business_services TEXT,                 -- servicios que ofrece
  plan TEXT NOT NULL DEFAULT 'starter' CHECK (plan IN ('starter','business','pro','enterprise')),
  features JSONB DEFAULT '{}',           -- override de features específicos
  calendar_config JSONB DEFAULT '{}',    -- Google Calendar config por tenant
  hubspot_config JSONB DEFAULT '{}',     -- HubSpot API keys por tenant (opcional)
  whatsapp_phone TEXT,                   -- número de WhatsApp mapeado a este tenant
  owner_name TEXT,
  owner_email TEXT,
  owner_phone TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug);
CREATE INDEX IF NOT EXISTS idx_tenants_whatsapp ON tenants(whatsapp_phone);
```

### 1.2 Plan features matrix

```js
const PLAN_FEATURES = {
  starter: {
    agents: 1,
    conversationsPerMonth: 100,
    scheduling: false,
    crm: false,
    knowledgeBase: false,
    whiteLabel: true,
  },
  business: {
    agents: 2,
    conversationsPerMonth: 500,
    scheduling: true,        // Google Calendar básico
    crm: true,               // HubSpot básico
    knowledgeBase: true,
    whiteLabel: true,
  },
  pro: {
    agents: -1,              // ilimitados
    conversationsPerMonth: -1,
    scheduling: true,
    crm: true,
    knowledgeBase: true,
    whiteLabel: true,
    api: true,
    analytics: true,
  },
  enterprise: {
    agents: -1,
    conversationsPerMonth: -1,
    scheduling: true,
    crm: true,
    knowledgeBase: true,
    whiteLabel: true,
    api: true,
    analytics: true,
    dedicatedSupport: true,
    onboarding: true,
  },
};
```

### 1.3 `tenant_id` en tablas existentes

Agregar columna `tenant_id UUID REFERENCES tenants(id)` a:

```sql
ALTER TABLE sessions ADD COLUMN tenant_id UUID REFERENCES tenants(id);
ALTER TABLE contacts ADD COLUMN tenant_id UUID REFERENCES tenants(id);
ALTER TABLE appointments ADD COLUMN tenant_id UUID REFERENCES tenants(id);
ALTER TABLE knowledge ADD COLUMN tenant_id UUID REFERENCES tenants(id); -- NULL = global
```

Los mensajes (`messages`) no necesitan `tenant_id` porque se acceden via `session_id`.

---

## Fase 2 — Resolución de tenant por request

### 2.1 Estrategias de routing

| Canal | Cómo identificar el tenant |
|---|---|
| **Widget web** | `<script src="/widget.js" data-tenant="clinica-san-jose">` |
| **WhatsApp web.js** | Número de teléfono entrante → `tenants.whatsapp_phone` |
| **Meta WhatsApp** | `phoneNumberId` del webhook → `tenants.whatsapp_phone` |
| **API directa** | Header `X-Tenant: clinica-san-jose` o path `/api/:tenant/...` |

### 2.2 Middleware `resolveTenant` (`src/middleware/tenant-resolver.js`)

```js
async function resolveTenant(req) {
  // 1. Widget web: data-tenant attribute en el body
  if (req.body?.tenant) return await store.getTenantBySlug(req.body.tenant);
  
  // 2. WhatsApp web.js: el from ya es el número de teléfono
  if (req.body?.from && req.body?.channel === 'whatsapp') {
    return await store.getTenantByPhone(req.body.from);
  }
  
  // 3. API header
  const slug = req.headers['x-tenant'];
  if (slug) return await store.getTenantBySlug(slug);
  
  // 4. Default / legacy (sin tenant)
  return await store.getDefaultTenant();
}
```

### 2.3 Modificación en `handleMessage`

```js
async function handleMessage({ message, from, channel, tenant, store, ai, crm, calendar }) {
  // tenant contiene: { id, slug, plan, features, calendar_config, ... }
  // Se usa para:
  //   - checkear quotas (tenant.plan → PLAN_FEATURES)
  //   - personalizar system prompt (tenant.business_name, tenant.business_services)
  //   - filtrar knowledge base (tenant.id)
  //   - decidir si usar calendar, crm, etc.
}
```

---

## Fase 3 — Feature gating por plan

### 3.1 Función `getTenantFeatures(tenant)`

```js
function getTenantFeatures(tenant) {
  const baseFeatures = PLAN_FEATURES[tenant.plan] || PLAN_FEATURES.starter;
  const overrides = tenant.features || {};
  return { ...baseFeatures, ...overrides };
}
```

### 3.2 Gating en `handleMessage`

```js
const features = getTenantFeatures(tenant);

// Solo busca en knowledge base si el plan lo permite
if (features.knowledgeBase && ai.generateEmbedding && store.searchKnowledge) {
  const embedding = await ai.generateEmbedding(message);
  knowledgeDocs = await store.searchKnowledge(embedding, 3, tenant.id);
}

// Solo agenda si el plan lo permite
if (leadData.intent === 'schedule' && features.scheduling && calendar) {
  return await handleScheduling({ ... });
}

// Solo registra en CRM si el plan lo permite
if (hasLeadInfo && features.crm) {
  await crm.getOrCreateContact(...);
}
```

### 3.3 Quota tracking

```sql
CREATE TABLE IF NOT EXISTS usage_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  metric TEXT NOT NULL,              -- 'conversations', 'api_calls', 'messages'
  value INTEGER DEFAULT 1,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usage_log_tenant ON usage_log(tenant_id, metric);
CREATE INDEX IF NOT EXISTS idx_usage_log_month ON usage_log(tenant_id, metric, recorded_at);
```

Check de quota en `handleMessage`:

```js
async function checkQuota(tenant, metric) {
  const features = getTenantFeatures(tenant);
  const limit = features[`${metric}PerMonth`];
  if (limit === -1) return true; // ilimitado

  const usage = await store.getMonthlyUsage(tenant.id, metric);
  if (usage >= limit) {
    logger.warn('Quota exceeded', { tenant: tenant.slug, metric, usage, limit });
    return false;
  }
  await store.logUsage(tenant.id, metric, 1);
  return true;
}
```

---

## Fase 4 — Dashboard del revendedor

### 4.1 Endpoints de administración

```
GET    /api/tenants                              → lista todos los tenants
POST   /api/tenants                              → crea nuevo tenant
GET    /api/tenants/:slug                        → detalle de un tenant
PUT    /api/tenants/:slug                        → editar tenant (plan, features, config)
DELETE /api/tenants/:slug                        → desactivar tenant

GET    /api/tenants/:slug/stats                  → stats del tenant (conversaciones, leads, appointments)
GET    /api/tenants/:slug/usage                  → uso mensual (conversaciones usadas/límite)
GET    /api/tenants/:slug/conversations          → conversaciones activas del tenant
GET    /api/tenants/:slug/leads                  → leads del tenant
GET    /api/tenants/:slug/appointments           → citas agendadas del tenant
```

### 4.2 Dashboard UI

Nueva sección en `dashboard.html` con pestaña "Clientes":

- Tabla de tenants con: nombre, plan, conversaciones del mes, leads, citas, estado
- Botón "Nuevo cliente" → formulario de creación
- Click en un tenant → vista detalle con stats + conversaciones + leads + citas
- Badges de plan: verde (Starter), azul (Business), dorado (Pro), rojo (Enterprise)

---

## Fase 5 — Knowledge base por tenant

La tabla `knowledge` actual es global. Con multi-tenant:

- `tenant_id = NULL` → documento global (visible para todos los tenants)
- `tenant_id = <uuid>` → documento específico de ese tenant

```sql
-- La búsqueda vectorial ahora filtra por tenant
SELECT content, metadata, 1 - (embedding <=> $1::vector) as similarity
FROM knowledge
WHERE embedding IS NOT NULL
  AND (tenant_id IS NULL OR tenant_id = $2)  -- global + específico del tenant
ORDER BY embedding <=> $1::vector
LIMIT $3
```

---

## Fase 6 — Calendar por tenant

Cada tenant puede tener su propia Google Calendar config:

```json
// tenants.calendar_config
{
  "clientEmail": "bot@clinicasanjose.iam.gserviceaccount.com",
  "privateKey": "-----BEGIN PRIVATE KEY-----...",
  "calendarId": "primary",
  "timezone": "America/Argentina/Buenos_Aires",
  "meetingDuration": 30
}
```

El `google-calendar-provider.js` se instancia por tenant (lazy):

```js
const calendarCache = new Map();

function getCalendarForTenant(tenant) {
  if (!tenant.calendar_config?.clientEmail) return null;
  const key = tenant.id;
  if (!calendarCache.has(key)) {
    calendarCache.set(key, createCalendarProvider(tenant.calendar_config));
  }
  return calendarCache.get(key);
}
```

---

## Fase 7 — WhatsApp multi-tenant

### Estrategia con whatsapp-web.js

Un solo número de WhatsApp atiende a todos los tenants. El routing se hace por palabra clave o número de teléfono del cliente final.

**Alternativa más escalable:** Mapear múltiples números de WhatsApp → tenant via `tenants.whatsapp_phone`.

### Estrategia con Meta WhatsApp API

Cada tenant puede tener su propio `phoneNumberId` y `accessToken`. El webhook de Meta identifica el `phoneNumberId` en el payload:

```js
// En meta-whatsapp-adapter.js handleIncoming:
const phoneNumberId = change?.value?.metadata?.phone_number_id;
const tenant = await store.getTenantByPhoneNumberId(phoneNumberId);
```

---

## Fase 8 — Widget multi-tenant

```html
<!-- Cliente 1: Clínica San José (plan Business) -->
<script src="https://bot.revendedor.com/widget.js"
  data-tenant="clinica-san-jose"
  data-primary="#059669">
</script>

<!-- Cliente 2: Estética Glamour (plan Starter) -->
<script src="https://bot.revendedor.com/widget.js"
  data-tenant="estetica-glamour"
  data-primary="#db2777">
</script>
```

El widget envía `tenant` en el body del POST:

```js
var body = JSON.stringify({
  message: text,
  from: visitorId,
  channel: 'web',
  tenant: cfg.tenant   // ← nuevo campo
});
```

---

## Resumen de archivos

| Acción | Archivo |
|---|---|
| **Nuevo** | `src/middleware/tenant-resolver.js` |
| **Nuevo** | `src/domain/tenant-features.js` |
| **Nuevo** | `src/ports/calendar-provider.js` |
| **Nuevo** | `src/adapters/outbound/google-calendar-provider.js` |
| **Nuevo** | `__tests__/middleware/tenant-resolver.test.js` |
| **Nuevo** | `__tests__/domain/scheduling.test.js` |
| **Nuevo** | `__tests__/domain/tenant-features.test.js` |
| **Modificar** | `src/config.js` (+ tenant defaults) |
| **Modificar** | `src/domain/entities.js` (+ Appointment) |
| **Modificar** | `src/domain/use-cases.js` (+ handleScheduling, quota checks, feature gating) |
| **Modificar** | `src/adapters/outbound/postgres-store.js` (+ tenants table, tenant_id FK, usage_log, +20 métodos) |
| **Modificar** | `src/adapters/outbound/ollama-provider.js` (+ scheduling en prompt, + tenant-aware business name) |
| **Modificar** | `src/adapters/outbound/hubspot-provider.js` (+ tenant-aware config) |
| **Modificar** | `src/adapters/inbound/express-adapter.js` (+ tenant endpoints, + availability/appointments endpoints, + middleware) |
| **Modificar** | `src/adapters/inbound/whatsapp-adapter.js` (+ tenant resolution por phone) |
| **Modificar** | `src/adapters/inbound/meta-whatsapp-adapter.js` (+ tenant resolution por phoneNumberId) |
| **Modificar** | `src/app.js` (+ tenant-aware DI, calendar cache, seed data) |
| **Modificar** | `public/widget.js` (+ data-tenant, + slot buttons) |
| **Modificar** | `public/dashboard.html` (+ pestaña Clientes, appointments, métricas por tenant) |
| **Modificar** | `.env.example` (+ calendar vars) |
| **Modificar** | `package.json` (+ googleapis) |

---

## Orden de implementación

| Fase | Semana | Qué entrega |
|---|---|---|
| **1** | 1 | Tabla `tenants` + `tenant_id` en tablas existentes + store methods |
| **2** | 2 | Middleware `resolveTenant` + feature gating + plan matrix |
| **3** | 3 | Calendar por tenant: provider + scheduling use case + prompt |
| **4** | 4 | Endpoints multi-tenant + widget multi-tenant + dashboard clientes |
| **5** | 5 | WhatsApp multi-tenant + knowledge base por tenant + quota tracking |
| **6** | 6 | Tests + integración + docs |

**Total: 7 archivos nuevos, 15 modificados. 6 semanas.**

---

## Beneficio a largo plazo

- **1 solo deploy** sirve a 20+ clientes del revendedor
- El revendedor crea un tenant en 2 minutos (llenar formulario en dashboard)
- El cliente pega el `<script>` en su sitio y ya tiene el bot funcionando
- Cada tenant escala independiente según su plan
- Feature flags permiten upsell: "¿Querés agendamiento? Pasate a Business"
