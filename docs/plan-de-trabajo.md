# Plan de Trabajo — Plataforma Multi-Tenant con Agendamiento

> **Versión:** 1.0
> **Fecha inicio:** Julio 2026
> **Duración estimada:** 6 semanas

---

## 1. Visión General

Transformar el Bot IA HubSpot de una herramienta single-tenant en una plataforma multi-tenant lista para revendedores. Cada cliente final del revendedor tendrá su propio tenant con plan, features, CRM HubSpot propio y agendamiento automático con Google Calendar.

### Diagrama conceptual

```
┌──────────────────────────────────────────────────────┐
│              REVENDEDOR (Dashboard único)              │
│                                                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐           │
│  │ Clínica  │  │ Estética │  │ Abogados │  ...20    │
│  │ San José │  │ Glamour  │  │   Ley    │  tenants  │
│  │ Business │  │ Starter  │  │   Pro    │           │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘           │
│       │             │             │                  │
│  ┌────┴─────────────┴─────────────┴────┐             │
│  │     BOT IA (1 sola instancia)       │             │
│  │  • Ollama LLM (local)               │             │
│  │  • pgvector + RAG                   │             │
│  │  • Multi-tenant routing             │             │
│  │  • Feature gating por plan          │             │
│  └─────────────────────────────────────┘             │
│                                                       │
│  Cliente A → su HubSpot + su Google Calendar         │
│  Cliente B → su HubSpot + su Google Calendar         │
│  Cliente C → su HubSpot + su Google Calendar         │
└──────────────────────────────────────────────────────┘
```

---

## 2. Planes y Features

| Feature | Starter | Business | Pro | Enterprise |
|---|---|---|---|---|
| Agentes | 1 | 2 | Ilimitados | Ilimitados |
| Conversaciones/mes | 100 | 500 | Ilimitadas | Ilimitadas |
| Agendamiento Google Calendar | ❌ | ✅ | ✅ | ✅ |
| CRM HubSpot | ❌ | ✅ | ✅ | ✅ |
| Knowledge Base (RAG) | ❌ | ✅ | ✅ | ✅ |
| White Label | ✅ | ✅ | ✅ | ✅ |
| API | ❌ | ❌ | ✅ | ✅ |
| Analytics | ❌ | ❌ | ✅ | ✅ |
| Soporte dedicado | ❌ | ❌ | ❌ | ✅ |

---

## 3. Roadmap por Fase

### Fase 1: Base de datos multi-tenant (Semana 1)
**Issue:** [#11](https://github.com/maurogallo/bot-ia-hubspot/issues/11)

- Tabla `tenants` con configuración por cliente (plan, features, calendar, HubSpot)
- Columna `tenant_id` en `sessions`, `contacts`, `knowledge`, `appointments`
- Tabla `appointments` para tracking de citas agendadas
- Tabla `usage_log` para tracking de cuotas
- Store methods: CRUD de tenants, appointments, usage

### Fase 2: Routing y feature gating (Semana 2)
**Issue:** [#12](https://github.com/maurogallo/bot-ia-hubspot/issues/12)

- Middleware `resolveTenant` que identifica tenant por widget, WhatsApp o API
- Matriz de features por plan (`tenant-features.js`)
- Feature gating en `handleMessage`: solo activa calendar/CRM/knowledge según plan
- Check de quotas antes de procesar mensajes

### Fase 3: Google Calendar + Scheduling (Semana 3)
**Issue:** [#13](https://github.com/maurogallo/bot-ia-hubspot/issues/13)

- Adaptador `google-calendar-provider.js` con service account (JWT)
- `getAvailability()`: consulta freebusy, devuelve slots libres
- `bookAppointment()`: crea evento con Google Meet, envía invitación
- `handleScheduling()`: flujo completo (detectar → proponer → confirmar → bookear)
- Prompt del LLM con intención `schedule` y extracción de fecha/hora

### Fase 4: API + Widget + Dashboard (Semana 4)
**Issue:** [#14](https://github.com/maurogallo/bot-ia-hubspot/issues/14)

- CRUD de tenants via API REST
- Endpoints de agendamiento: `GET /api/availability`, `POST /api/appointments`
- Widget.js: soporte para `data-tenant`, botones de selección de horario
- Dashboard HTML: pestañas "Clientes" y "Citas", métricas por tenant

### Fase 5: WhatsApp + Knowledge + Quotas (Semana 5)
**Issue:** [#15](https://github.com/maurogallo/bot-ia-hubspot/issues/15)

- WhatsApp web.js y Meta API: routing por número de teléfono
- Knowledge base: filtrado por tenant (`tenant_id IS NULL OR tenant_id = $2`)
- Quota tracking: check de límites, reset mensual, alertas en dashboard

### Fase 6: Tests + Documentación (Semana 6)
**Issue:** [#16](https://github.com/maurogallo/bot-ia-hubspot/issues/16)

- Tests unitarios para middleware, scheduling, tenant features
- Tests de adaptadores: calendar provider, store, endpoints
- Tests de integración: flujo completo multi-tenant
- Documentación para revendedores (`docs/multi-tenant-guide.md`)
- Actualización de `AGENTS.md` y `.env.example`

---

## 4. Arquitectura de archivos

### Nuevos (7 archivos)
```
src/
├── middleware/
│   └── tenant-resolver.js          # Resolución de tenant por request
├── ports/
│   └── calendar-provider.js        # Interfaz CalendarProvider
├── adapters/outbound/
│   └── google-calendar-provider.js # Adaptador Google Calendar API
├── domain/
│   └── tenant-features.js          # Matriz de features por plan
└── __tests__/
    ├── middleware/
    │   └── tenant-resolver.test.js
    ├── domain/
    │   ├── scheduling.test.js
    │   └── tenant-features.test.js
    └── adapters/
        └── google-calendar-provider.test.js
```

### Modificados (15 archivos)
```
src/
├── config.js                       # + bloque calendar
├── domain/
│   ├── entities.js                 # + Appointment entity
│   └── use-cases.js               # + handleScheduling, feature gating
├── ports/
│   └── ai-provider.js              # (doc only: scheduling contract)
├── adapters/outbound/
│   ├── ollama-provider.js          # + scheduling en prompt
│   ├── hubspot-provider.js         # + tenant-aware config
│   └── postgres-store.js           # + tenants, appointments, usage_log
├── adapters/inbound/
│   ├── express-adapter.js          # + 14 endpoints nuevos
│   ├── whatsapp-adapter.js         # + tenant routing
│   └── meta-whatsapp-adapter.js    # + tenant routing por phoneNumberId
├── app.js                          # + calendar DI, resolveTenant
├── public/
│   ├── widget.js                   # + data-tenant, slot buttons
│   └── dashboard.html              # + pestañas Clientes, Citas
├── .env.example                    # + calendar vars
└── package.json                    # + googleapis
```

---

## 5. Dependencias nuevas

```json
{
  "googleapis": "^140.0.0"
}
```

---

## 6. Variables de entorno nuevas

```env
# Google Calendar (service account)
GOOGLE_CLIENT_EMAIL=bot@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GOOGLE_CALENDAR_ID=primary
BUSINESS_TIMEZONE=America/Argentina/Buenos_Aires
MEETING_DURATION_MINUTES=30

# Feature flags
FEATURE_SCHEDULING=true
FEATURE_QUOTA_TRACKING=true
```

---

## 7. Métricas de éxito

| Métrica | Objetivo |
|---|---|
| Tests passing | 50+ (actual: 34) |
| Code coverage | 70%+ |
| Latencia adicional por tenant routing | <10ms |
| Latencia adicional por scheduling | <300ms (API de Google) |
| Tenants simultáneos soportados | 20+ |

---

## 8. Riesgos

| Riesgo | Mitigación |
|---|---|
| Google Calendar API rate limits | Cache de disponibilidad (5 min TTL), batch de freebusy |
| Ollama no entiende fechas en español | Afinar prompt con ejemplos concretos de fechas |
| Complejidad del dashboard multi-tenant | Priorizar funcionalidad sobre diseño, iterar en fase 4 |
| Migración de tablas existentes con datos | Usar `ALTER TABLE ... ADD COLUMN ... DEFAULT NULL` (no bloquea) |

---

## 9. Issues en GitHub

| # | Fase | Issue |
|---|---|---|
| 11 | Fase 1 | [Tabla tenants + migración de tablas existentes](https://github.com/maurogallo/bot-ia-hubspot/issues/11) |
| 12 | Fase 2 | [Middleware resolveTenant + feature gating + plan matrix](https://github.com/maurogallo/bot-ia-hubspot/issues/12) |
| 13 | Fase 3 | [Calendar provider + scheduling use case + prompt IA](https://github.com/maurogallo/bot-ia-hubspot/issues/13) |
| 14 | Fase 4 | [Endpoints multi-tenant + widget + dashboard clientes](https://github.com/maurogallo/bot-ia-hubspot/issues/14) |
| 15 | Fase 5 | [WhatsApp multi-tenant + knowledge base + quota tracking](https://github.com/maurogallo/bot-ia-hubspot/issues/15) |
| 16 | Fase 6 | [Tests + integración + documentación final](https://github.com/maurogallo/bot-ia-hubspot/issues/16) |

---

## 10. Cronograma

```
Semana 1  ████████  Fase 1: DB multi-tenant
Semana 2  ████████  Fase 2: Routing + feature gating
Semana 3  ████████  Fase 3: Calendar + scheduling
Semana 4  ████████  Fase 4: API + widget + dashboard
Semana 5  ████████  Fase 5: WhatsApp + knowledge + quotas
Semana 6  ████████  Fase 6: Tests + docs
         ─────────────────────────────────────
         6 semanas  |  7 archivos nuevos  |  15 modificados
```
