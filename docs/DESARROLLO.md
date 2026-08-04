# Bot IA HubSpot — Documentación de Desarrollo v3.0

> Última actualización: 4 de agosto de 2026

---

## 1. Resumen Ejecutivo

Bot comercial multicanal con IA (GPT-4o mini) que captura, califica y registra leads en HubSpot CRM. Arquitectura multi-tenant con white-label, agendamiento con Google Calendar, y templates por industria.

### Stack Actual

| Componente | Tecnología | Costo |
|---|---|---|
| Backend | Node.js + Express | $0 |
| IA | GPT-4o mini (primary) + Ollama (fallback) | ~$0.05/mes |
| Base de Datos | PostgreSQL 16 + pgvector | $0 |
| Embeddings | nomic-embed-text (Ollama) | $0 |
| CRM | HubSpot (Service Key) | $0 |
| WhatsApp | whatsapp-web.js + Meta Business API | $0 |
| Widget Web | JS embebible (vanilla) | $0 |
| Agendamiento | Google Calendar API (Service Account) | $0 |
| Infraestructura | Docker Compose | $0 (OCI) |

**Costo operativo total: ~$0.05/mes por tenant.**

---

## 2. Funcionalidades Implementadas

### 2.1 Multi-Tenant
- ✅ Tabla `tenants` con slug, plan, features, credenciales
- ✅ 4 planes: Starter, Business, Pro, Enterprise
- ✅ Feature gating: scheduling, CRM, knowledge base, API
- ✅ Resolución de tenant por widget (`data-tenant`), WhatsApp (`phone`), header (`X-Tenant`)
- ✅ Fallback a tenant default

### 2.2 Captura de Datos
- ✅ Flujo secuencial: nombre → email → teléfono → agendar
- ✅ Extracción por regex del mensaje (independiente del LLM)
- ✅ Memoria persistente en `sessions.context.memory`
- ✅ Instrucciones dinámicas según datos faltantes

### 2.3 Agendamiento (Google Calendar)
- ✅ `google-calendar-provider.js` con Service Account (JWT)
- ✅ `getAvailability()`: consulta freebusy + slots libres
- ✅ `bookAppointment()`: crea evento + Google Meet + invitación
- ✅ Tabla `appointments` con tracking de citas
- ✅ Gatillado por `intent: "schedule"` del LLM

### 2.4 CRM (HubSpot)
- ✅ Creación automática de contactos
- ✅ Creación de deals por lead de alta intención
- ✅ Pipeline stage: `appointmentscheduled`

### 2.5 Knowledge Base (RAG)
- ✅ Tabla `knowledge` con embeddings pgvector (768d)
- ✅ Índice HNSW con cosine similarity
- ✅ Tenant-aware: `tenant_id IS NULL OR tenant_id = $2`
- ✅ Endpoints CRUD: GET/POST/DELETE `/api/knowledge`

### 2.6 Dashboard
- ✅ Pestañas: Conversaciones, Handoffs, Leads, Clientes, Citas
- ✅ Tabla de clientes con plan, quota bars, acciones
- ✅ Wizard 3 pasos: datos → features → servicios
- ✅ Modal para editar servicios por tenant
- ✅ Botón copiar código widget

### 2.7 Widget Web
- ✅ JS vanilla, sin dependencias
- ✅ `data-tenant`, `data-business`, `data-primary`, `data-welcome`
- ✅ Botones de slots clickeables (A/B/C)
- ✅ Instalado en `synaptiqnova.online`

### 2.8 Templates por Industria
- ✅ Tabla `industry_templates` con 8 industrias
- ✅ Dropdown en wizard para crear tenant con servicios pre-cargados
- ✅ Templates: Salud, Legal, Inmobiliaria, Educación, Estética, Restaurantes, Tecnología, Finanzas
- ✅ Cada template: 4 servicios, 3 knowledge docs, 4 preguntas de calificación

### 2.9 AI Providers
- ✅ GPT-4o mini (primary, <2s, $0.0001/msg)
- ✅ Ollama (fallback, local, gratuito)
- ✅ Groq (legacy, reemplazado)
- ✅ Gemini (legacy, reemplazado)
- ✅ Cache tenant-aware para respuestas frecuentes

### 2.10 WhatsApp
- ✅ whatsapp-web.js (QR code, sesión persistente)
- ✅ Meta Business API (webhook, verify token)
- ✅ Deduplicación de mensajes
- ✅ Chromium lock fix en entrypoint
- ✅ Documentación completa: `docs/meta-whatsapp-setup.md`

### 2.11 Email Notifications
- ✅ `notification-service.js` con nodemailer (Gmail SMTP)
- ✅ Email automático al dueño del tenant cuando se captura nombre + email
- ✅ Configurable por tenant via `tenants.owner_email`
- ✅ SMTP via app password (2FA)

### 2.12 Seguridad
- ✅ Rate limiting (200 req/min)
- ✅ HMAC signature verification en webhooks
- ✅ Dashboard con autenticación (usuario/contraseña)
- ✅ Helmet.js headers de seguridad
- ✅ CORS configurable

---

## 3. Base de Datos

### Tablas (10)

| Tabla | Descripción |
|---|---|
| `sessions` | Sesiones conversacionales por canal |
| `messages` | Historial de mensajes |
| `contacts` | Leads registrados |
| `tenants` | Configuración multi-tenant |
| `tenant_services` | Servicios personalizados por tenant |
| `industry_templates` | Templates pre-configurados (8 industrias) |
| `appointments` | Citas agendadas |
| `usage_log` | Tracking de conversaciones por mes |
| `knowledge` | Base de conocimiento vectorial (pgvector) |
| `appointments` | Citas con Google Calendar |

---

## 4. Endpoints API (35+)

### Tenants
| Método | Ruta |
|---|---|
| GET/POST | `/api/tenants` |
| GET/PUT/DELETE | `/api/tenants/:slug` |
| GET | `/api/tenants/:slug/stats` |
| GET | `/api/tenants/:slug/usage` |
| GET | `/api/tenants/:slug/conversations` |
| GET | `/api/tenants/:slug/leads` |
| GET | `/api/tenants/:slug/appointments` |
| GET | `/api/tenants/:slug/handoffs` |
| GET/POST/DELETE | `/api/tenants/:slug/services` |

### Templates
| Método | Ruta |
|---|---|
| GET | `/api/templates` |

### Scheduling
| Método | Ruta |
|---|---|
| GET | `/api/availability?date=YYYY-MM-DD&tenant=slug` |
| POST | `/api/appointments` |
| GET | `/api/appointments?email=x&tenant=slug` |
| DELETE | `/api/appointments/:id` |

### Knowledge
| Método | Ruta |
|---|---|
| GET/POST | `/api/knowledge?tenant=slug` |
| DELETE | `/api/knowledge/:id` |
| POST | `/api/knowledge/reseed` |

### Dashboard
| Método | Ruta |
|---|---|
| GET | `/api/dashboard/stats` |
| GET | `/api/dashboard/conversations` |
| GET | `/api/dashboard/conversations/:id` |
| GET | `/api/dashboard/leads` |
| GET | `/api/dashboard/handoffs` |
| POST | `/api/dashboard/handoffs/:id/assign` |

### Chat
| Método | Ruta |
|---|---|
| POST | `/api/webhook` (widget web) |
| GET/POST | `/api/meta-webhook` (Meta WhatsApp) |

### Páginas
| Ruta | Descripción |
|---|---|
| `/` | Landing page NeoWeb Studio |
| `/health` | Health check |
| `/dashboard` | Dashboard admin |
| `/widget/test` | Widget demo |
| `/widget.js` | Widget script |
| `/whatsapp/qr` | WhatsApp QR |

---

## 5. Archivos del Proyecto

```
src/
├── domain/
│   ├── entities.js              # Session, Message, Lead, Appointment
│   ├── use-cases.js             # handleMessage, handleScheduling, extractFromMessage
│   └── tenant-features.js       # PLAN_FEATURES, getTenantFeatures, canUseFeature
├── ports/
│   ├── ai-provider.js
│   ├── crm-provider.js
│   ├── conversation-store.js
│   └── calendar-provider.js
├── adapters/
│   ├── inbound/
│   │   ├── express-adapter.js   # 35+ endpoints
│   │   ├── whatsapp-adapter.js  # whatsapp-web.js
│   │   └── meta-whatsapp-adapter.js
│   └── outbound/
│       ├── postgres-store.js    # 10 tablas, ~60 métodos
│       ├── openai-provider.js   # GPT-4o mini (primary)
│       ├── ollama-provider.js   # Ollama (fallback)
│       ├── groq-provider.js     # Groq (legacy)
│       ├── gemini-provider.js   # Gemini (legacy)
│       ├── hubspot-provider.js  # HubSpot CRM
│       └── google-calendar-provider.js
├── middleware/
│   └── tenant-resolver.js       # Resolución multi-tenant
├── config.js                    # Config centralizada
├── logger.js                    # Winston
├── app.js                       # DI Container + seeds
└── server.js                    # Entry point
```

---

## 6. Tests

- 64 tests unitarios
- 6 test suites
- Cobertura: domain >80%, express <30%

---

## 7. Infraestructura (OCI)

| Recurso | Especificación |
|---|---|
| VM | ARM64, 4 OCPU, 24 GB RAM |
| OS | Oracle Linux 9.7 |
| Docker | 29.5.1 + Compose v5.1.3 |
| IP | 132.145.202.10 |
| Dominios | synaptiqnova.online, bot.synaptiqnova.online + 10 WP |
| SSL | Cloudflare Origin CA + Let's Encrypt |

### Containers (24)
- Bot-IA: bot, postgres, ollama
- FastAPIPOS: 18 containers
- ClearApp: php, mysql (10 WordPress)
- SonarQube: standalone

---

## 8. Issues en GitHub

| # | Fase | Estado |
|---|---|---|
| 11-16 | Fases 1-6 originales | ✅ Completado |
| 17 | Fase 2: Templates por industria | ✅ Completado |
| 18 | Fase 3: Landing + Meta Provider + canales | 📝 Pendiente |
| 19 | Fase 4: Billing (Stripe) + notificaciones | 📝 Pendiente |
| 20 | Fase 5: Analytics + exportación | 📝 Pendiente |

---

## 9. Roadmap Pendiente

| Fase | Semanas | Prioridad |
|---|---|---|
| Landing revendedores + Meta Provider | 2 | Alta |
| Billing automático (Stripe) | 2 | Alta |
| Analytics + exportación | 2 | Media |
| Canales extra (IG, FB, Telegram) | 1 | Media |
| Notificaciones email | 1 | Media |

---

## 10. Changelog

### 4 de agosto de 2026
- **Email notifications**: envio automatico a `synaptiqnova@gmail.com` al capturar lead completo (nombre + email)
- **Meta WhatsApp**: token regenerado, webhook verificado, documentacion completa
- **Quotas**: tenants subidos a plan Pro (ilimitado), usage_log limpiado
- **Meta Business API credenciales**: App ID `2352206648917615`, Phone ID `1231833500016705`, WABA ID `1342251534637602`

### 2 de agosto de 2026
- **GPT-4o mini**: migracion completada (<2s, español excelente). Luego revertido a Groq por costo ($16,000 COP en testing)
- **Templates 8 industrias**: Salud, Legal, Inmobiliaria, Educacion, Estetica, Restaurantes, Tecnologia, Finanzas
- **Landing revendedores**: `/partners` con ROI calculator interactivo
- **Telegram Bot**: `@Neowebstudiobot` funcionando con webhook
- **Servicios dinamicos**: Synaptiq Nova con Fabric, Databricks, BI, Analytics
- **Cache tenant-aware**: respuestas no se mezclan entre clientes
- **Data extraction**: regex por mensaje para nombre/email/telefono
- **Fallback Ollama**: cuando Groq falla, responde con LLM local

## 11. Ventajas Competitivas

| Ventaja | Detalle |
|---|---|
| Costo marginal cero | $0.05/mes por tenant en IA |
| Multi-tenant real | Un deploy, N clientes, feature gating |
| HubSpot nativo | Sin Zapier ni middleware |
| Google Calendar real | No solo booking, scheduling completo |
| Templates industria | 8 industrias pre-configuradas |
| RAG local | pgvector, sin servicios externos |
| Fallback local | Ollama cuando la API falla |
| Código abierto | Sin vendor lock-in |
