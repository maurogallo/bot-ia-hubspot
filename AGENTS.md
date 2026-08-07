# Bot IA HubSpot — Documentación del Desarrollo

## Objetivo del Negocio

Bot comercial multicanal impulsado por IA que captura, califica y registra leads en HubSpot CRM. El cliente llega desde anuncios en redes sociales (Instagram, Facebook, TikTok, X), interactúa con el bot vía WhatsApp o web, y el agente IA lo convierte en un lead registrado automáticamente.

### Canales de captura de leads

```
Anuncio en Instagram/Facebook/TikTok/X
  ├→ Click a WhatsApp → Bot atiende → Lead a HubSpot
  └→ Click a Landing Page → Widget web → Bot atiende → Lead a HubSpot
```

### Stack tecnológico

| Componente | Tecnología | Estado |
|---|---|---|
| Backend | Node.js + Express | ✅ Implementado |
| Base de datos | PostgreSQL 16 + pgvector | ✅ Implementado |
| Vector DB | pgvector + nomic-embed-text | ✅ Implementado |
| LLM local | Ollama (llama3.2:3b) | ✅ Implementado |
| CRM | HubSpot (Service Key) | ✅ Implementado |
| WhatsApp | whatsapp-web.js (sesión persistente) | ✅ Implementado |
| Chat web | Widget JS embebible | ✅ Implementado |
| Agendamiento | Google Calendar API (Service Account) | ✅ Implementado |
| Multi-tenant | Resolución por widget/WhatsApp/header | ✅ Implementado |
| Infraestructura | Docker Compose | ✅ Implementado |
| CI/CD | GitHub Actions | ✅ Completado |
| Entornos | Dev / Staging / Prod via Docker Compose | ✅ Completado |

## Arquitectura

### Estructura del proyecto (Arquitectura Hexagonal)

```
src/
├── domain/                     # Hexágono — cero dependencias externas
│   ├── entities.js             # Session, Message, Lead (objetos puros)
│   └── use-cases.js            # handleMessage (caso de uso principal)
├── ports/                      # Interfaces / contratos
│   ├── conversation-store.js   # Almacenamiento de sesiones y mensajes
│   ├── ai-provider.js          # Generación de respuestas IA
│   └── crm-provider.js         # Integración con CRM
├── adapters/
│   ├── inbound/                # Adaptadores de entrada
│   │   ├── express-adapter.js  # HTTP (REST API, webhook, static files)
│   │   └── whatsapp-adapter.js # whatsapp-web.js (eventos entrantes)
│   └── outbound/               # Adaptadores de salida
│       ├── postgres-store.js   # ConversationStore → PostgreSQL
│       ├── ollama-provider.js  # AIProvider → Ollama (Llama 3/Mistral)
│       └── hubspot-provider.js # CRMProvider → HubSpot OAuth2
├── config.js                   # Config centralizada con validación
├── logger.js                   # Winston (consola + archivos rotados)
├── app.js                      # Punto de inyección de dependencias (DI)
└── server.js                   # Entry point con graceful shutdown
```

### Inyección de dependencias (app.js)

```
app.js (DI Container)
  ├→ postgres-store.js   → store  ──┐
  ├→ ollama-provider.js   → ai    ──┤
  ├→ hubspot-provider.js  → crm   ──┤
  └→ use-cases.js (handleMessage) ──┤
                                      ▼
                              express-adapter(deps)
                              whatsapp-adapter(deps)
```

Los adaptadores reciben las dependencias por constructor. El dominio nunca importa nada externo.

### Flujo del mensaje

```
Mensaje entrante (WhatsApp o Webhook)
        ↓
session.getOrCreateSession() → busca sesión activa por teléfono
        ↓
session.addMessage('user', mensaje) → persiste el mensaje
        ↓
session.getConversationHistory() → últimos 20 mensajes
        ↓
session.getMemory() → recupera memoria key-value del cliente
        ↓
ai.generateEmbedding(mensaje) → embedding vector 768d
        ↓
store.searchKnowledge(embedding, 3) → top-3 docs similares (cosine)
        ↓
ai.generateResponse(prompt + historial + memoria + knowledge)
        ├→ LLM genera respuesta + bloque JSON [LEAD_DATA]
        └→ extrae: intent, lead (name/email/phone/service_interest), confidence
        ↓
session.addMessage('assistant', respuesta) → persiste respuesta
        ↓
session.upsertMemory() → guarda datos nuevos del lead
        ↓
¿intent === 'lead' && email?
  ├→ Sí → hubspot.getOrCreateContact() → registra en HubSpot
  │        → contacts INSERT/UPDATE en PostgreSQL
  │        → updateSessionContext con hubspotContactId
  └→ No → responde sin registro
        ↓
Envía respuesta al canal origen
```

### RAG (Memoria persistente con base vectorial)

#### ¿Cómo funciona?

Cada mensaje del usuario pasa por 3 etapas antes de generar la respuesta:

1. **Embedding**: El mensaje se envía a Ollama con el modelo `nomic-embed-text` (274 MB, vector de 768 dimensiones) que genera un embedding semántico. Esto permite buscar por significado, no por palabras clave.

2. **Búsqueda vectorial**: El embedding se busca en la tabla `knowledge` de PostgreSQL usando el operador de distancia coseno (`<=>`). El índice HNSW (`vector_cosine_ops`) permite búsquedas en tiempo sub-segundo incluso con miles de documentos. Se recuperan los top-3 documentos más relevantes.

3. **Inyección en el prompt**: Los documentos recuperados se agregan al system prompt de Ollama en un bloque `## INFORMACIÓN DE LA EMPRESA` con la instrucción de usarlos para responder con precisión sobre servicios, precios y procesos.

#### Semilla inicial de conocimiento

En `app.js` se define `KNOWLEDGE_SEED` con 10 documentos que cubren:
- Información de la empresa (NeoWeb Studio)
- Descripción de servicios (landing pages, desarrollo web, automatización) con precios
- Preguntas frecuentes (dominio, hosting, mantenimiento, proceso de trabajo)
- Casos de éxito, diferenciadores (IA local), garantías

Al iniciar el servidor, si la tabla `knowledge` está vacía, se genera el embedding de cada documento con `nomic-embed-text` y se inserta automáticamente.

### Prompt del agente IA (ollama-provider.js)

El system prompt define al agente como asesor comercial de `NeoWeb Studio` con:

- **Servicios**: landing pages ($299+), desarrollo web ($799+), automatización ($499+)
- **Flujo de ventas**: presentación → preguntar necesidad → proponer → agendar
- **Estrategia**: upselling, urgencia, cierre
- **Salida estructurada**: bloque `[LEAD_DATA]` con JSON que el backend parsea
- **Knowledge injection**: bloque `## INFORMACIÓN DE LA EMPRESA` con los documentos recuperados vía RAG

El prompt es dinámico y toma la configuración de `BUSINESS_NAME` y `BUSINESS_SERVICES` del `.env`, más los bloques de memoria persistente y knowledge documents.

### Estructura del prompt generado

```
Eres un asesor comercial experto de {business.name}...

## INFORMACIÓN DEL CLIENTE (conversaciones previas)
- contact_name: {memoria}
- service_interest: {memoria}
Usa esta información para no preguntar datos que ya te dieron.

## INFORMACIÓN DE LA EMPRESA (usa esto para responder con precisión)
1. Servicio: Landing Pages. Desde $299 USD...
2. Servicio: Desarrollo Web. Desde $799 USD...
3. Pregunta frecuente: ¿Ofrecen mantenimiento?...
Usa esta información para dar respuestas precisas sobre servicios, precios y procesos.
No inventes información que no esté aquí.

## TU PERSONALIDAD
...

## REGLA CRÍTICA: DERIVACIÓN A HUMANO
...

## FORMATO
...
[LEAD_DATA] { ... } [/LEAD_DATA]
```

## Base de datos (PostgreSQL)

### Tablas

**sessions** — Sesiones conversacionales
- `id` UUID PRIMARY KEY
- `channel` TEXT (whatsapp|web)
- `phone` TEXT (para reanudar sesión)
- `context` JSONB (datos extraídos del lead, memoria persistente)
- `is_active` BOOLEAN

**messages** — Historial de mensajes por sesión
- `id` UUID PRIMARY KEY
- `session_id` UUID FK → sessions
- `role` TEXT (user|assistant|system|tool)
- `content` TEXT
- `metadata` JSONB (lead_data del AI agent)

**contacts** — Leads registrados
- `id` UUID PRIMARY KEY
- `hubspot_id` TEXT UNIQUE
- `name`, `email` (UNIQUE), `phone`
- `last_interaction` TIMESTAMPTZ

**knowledge** — Base de conocimiento vectorial (RAG)
- `id` UUID PRIMARY KEY DEFAULT gen_random_uuid()
- `content` TEXT NOT NULL
- `metadata` JSONB DEFAULT '{}' (tipo, servicio asociado, etc.)
- `embedding` vector(768) — embedding generado por nomic-embed-text
- `created_at` TIMESTAMPTZ DEFAULT NOW()
- Índice HNSW sobre embedding con `vector_cosine_ops` (m=16, ef_construction=64)

## Roadmap (Issues)

| # | Issue | Prioridad | Estado |
|---|---|---|---|---|
| 1 | Dashboard web para monitorear conversaciones | Media | ✅ Completado |
| 4 | Widget de chat web embebible para landing pages | Alta | ✅ Completado |
| — | Landing página estilo FastApiPOS | Alta | ✅ Completado |
| — | Modelo Ollama optimizado (llama3.2:3b) | Alta | ✅ Completado |
| — | Deduplicación de mensajes WhatsApp | Alta | ✅ Completado |
| — | Chromium lock fix permanente | Alta | ✅ Completado |
| 2 | Meta WhatsApp Business API (alternativa producción) | Alta | ✅ Implementado |
| 3 | Tests automatizados (Jest, unitarios + integración) | Alta | ✅ Completado (74 tests) |
| 5 | Creación automática de deals en HubSpot | Media | ✅ Completado |
| — | Dashboard rediseñado (UI tipo BotPenguin + wizard "Create Chatbot" 4 pasos) | Alta | ✅ Completado |
| 6 | Analíticas de conversión y métricas | Media | ✅ Completado |
| 7 | Verificación de firmas HMAC en webhooks | Alta | ✅ Completado |
| 8 | Soporte multilingüe (inglés, portugués) | Baja | 📝 Pendiente |
| 9 | CI/CD con GitHub Actions | Alta | ✅ Completado |
| 10 | Configuración de entornos (dev/staging/prod) | Alta | ✅ Completado |
| 11 | Arquitectura multi-tenant (tabla tenants, resolver, feature gating) | Alta | ✅ Completado |
| 12 | Google Calendar agendamiento automático | Alta | ✅ Completado |
| 13 | Dashboard de clientes y citas | Alta | ✅ Completado |
| 14 | Sistema de quotas por plan | Alta | ✅ Completado |
| 15 | Knowledge base por tenant | Alta | ✅ Completado |

## Arquitectura Multi-Tenant

### Tabla tenants
```sql
tenants (id, slug, business_name, business_services, plan, features, calendar_config, hubspot_config, whatsapp_phone, whatsapp_phone_number_id, owner_name, owner_email, owner_phone, is_active)
```

### Planes y features
| Plan | Agentes | Conversaciones/mes | Scheduling | CRM | Knowledge Base |
|---|---|---|---|---|---|
| Starter ($29/mes) | 1 | 100 | ❌ | ❌ | ❌ |
| Business ($79/mes) | 2 | 500 | ✅ | ✅ | ✅ |
| Pro ($149/mes) | Ilimitados | Ilimitadas | ✅ | ✅ | ✅ |
| Enterprise ($299/mes) | Ilimitados | Ilimitadas | ✅ | ✅ | ✅ |

### Resolución de tenant
- **Widget web**: `data-tenant="slug"` → `POST { tenant: "slug" }` → `store.getTenantBySlug()`
- **WhatsApp web.js**: `message.from` → `store.getTenantByPhone()`
- **Meta WhatsApp**: `metadata.phone_number_id` → `store.getTenantByPhoneNumberId()`
- **API**: header `X-Tenant: slug` o body `{ "tenant": "slug" }`
- **Fallback**: `store.getDefaultTenant()` → tenant con slug `"default"` o el más antiguo

### Feature gating en handleMessage
```
handleMessage({ tenant, ... })
  → getTenantFeatures(tenant)  → { scheduling: true/false, crm: true/false, knowledgeBase: true/false }
  → checkQuota(tenant, 'conversations')  → si excedido → "limite alcanzado"
  → if features.knowledgeBase → RAG search (tenant-aware)
  → if features.crm → HubSpot contact + deal creation
  → if features.scheduling → handleScheduling (Google Calendar)
```

### Tablas multi-tenant
- `sessions.tenant_id` → FK a tenants
- `contacts.tenant_id` → FK a tenants
- `appointments.tenant_id` → FK a tenants
- `knowledge.tenant_id` → FK a tenants (NULL = global)
- `usage_log` → tracking de conversaciones por tenant por mes

## Agendamiento con Google Calendar

### Flujo
```
Usuario: "Quiero agendar una reunion"
  → LLM: intent="schedule", scheduling.action="request_availability"
  → calendar.getAvailability(fecha) → slots libres
  → Bot: "A) 10:00 AM  B) 14:00 PM  C) 16:00 PM"
  → Widget: renderiza 3 botones clickeables
  
Usuario: clickea "14:00 PM"
  → LLM: intent="schedule", scheduling.action="confirm_slot"
  → calendar.bookAppointment(name, email, datetime) → Google Meet
  → store.saveAppointment(...)
  → Bot: "Listo! Te envié la invitación. Nos vemos el..."
```

### Google Calendar Service Account
- Auth: JWT con `clientEmail` + `privateKey`
- Métodos: `getAvailability`, `bookAppointment`, `getScheduledAppointments`, `cancelEvent`
- Cada tenant puede tener su propia `calendar_config`
- Soporta timezone personalizado (`BUSINESS_TIMEZONE`)

### Tabla appointments
```sql
appointments (id, tenant_id, session_id, contact_email, contact_name, contact_phone, google_event_id, service_interest, start_time, end_time, status, metadata)
```

## Nuevos Endpoints

### Tenants
| Ruta | Método | Descripción |
|---|---|---|
| `/api/tenants` | GET | Listar todos los tenants |
| `/api/tenants` | POST | Crear nuevo tenant |
| `/api/tenants/:slug` | GET | Detalle de un tenant |
| `/api/tenants/:slug` | PUT | Editar tenant |
| `/api/tenants/:slug` | DELETE | Desactivar tenant |
| `/api/tenants/:slug/stats` | GET | Stats del tenant |
| `/api/tenants/:slug/usage` | GET | Uso mensual (conversaciones) |
| `/api/tenants/:slug/conversations` | GET | Conversaciones del tenant |
| `/api/tenants/:slug/leads` | GET | Leads del tenant |
| `/api/tenants/:slug/appointments` | GET | Citas del tenant |
| `/api/tenants/:slug/handoffs` | GET | Handoffs del tenant |

### Agendamiento
| Ruta | Método | Descripción |
|---|---|---|
| `/api/availability?date=YYYY-MM-DD&tenant=slug` | GET | Slots disponibles |
| `/api/appointments` | POST | Crear cita |
| `/api/appointments?email=x&tenant=slug` | GET | Listar citas |
| `/api/appointments/:id` | DELETE | Cancelar cita |

## Mejoras a futuro

| Mejora | Descripción |
|---|---|
| **Memoria persistente (RAG)** | ✅ Completado — Base de conocimiento vectorial con pgvector + nomic-embed-text. Los documentos se buscan por similitud semántica y se inyectan en el prompt. |
| **Base de datos vectorial** | ✅ Completado — pgvector con índice HNSW sobre embeddings de 768 dimensiones. |
| **Fine-tuning del modelo** | Reentrenar el modelo periódicamente con conversaciones exitosas para mejorar calidad y tono |
| **Cache de respuestas** | Cachear respuestas frecuentes para reducir latencia |
| **Analíticas avanzadas** | Dashboard con tasas de conversión, fuentes de tráfico, ROI por campaña |
| **Meta WhatsApp Business API** | Reemplazar whatsapp-web.js por la API oficial de Meta para producción a escala |
| **Multilingüe** | Soporte para inglés y portugués detectando el idioma del usuario |

## Decisiones técnicas

### ¿Por qué Ollama local en vez de OpenAI?
El usuario solicitó modelo local (Llama 3 / Mistral) para evitar costos recurrentes de API y tener control total de los datos.

### ¿Por qué whatsapp-web.js en vez de Meta API?
whatsapp-web.js es gratuito y no requiere aprobación de Meta. Para producción a escala está previsto migrar a Meta WhatsApp Business API (Issue #2) usando el patrón strategy.

### ¿Por qué Service Key (access token) en vez de OAuth2?
Se usa un token de acceso directo de HubSpot (Service Key) por simplicidad. No requiere flujo OAuth ni refresh tokens.

### ¿Por qué PostgreSQL en vez de SQLite?
El usuario solicitó PostgreSQL para producción. Las sesiones y mensajes requieren concurrencia y fiabilidad que PostgreSQL ofrece. Además, pgvector requiere PostgreSQL.

### ¿Por qué nomic-embed-text para embeddings?
- Modelo pequeño (274 MB) que corre rápido incluso en CPU
- Genera vectores de 768 dimensiones (balance entre precisión y rendimiento)
- Compatible con la API de embeddings de Ollama sin configuración adicional
- Suficiente calidad semántica para el dominio acotado de servicios web

### ¿Por qué pgvector y no una base vectorial dedicada (ChromaDB / Qdrant)?
- Evita un servicio adicional en la infraestructura
- Los embeddings viven en la misma base de datos transaccional
- Índice HNSW nativo para búsqueda por similitud coseno
- Unico stack de datos para simplificar backups y mantenimiento

### Meta WhatsApp Business API
- Implementado como adapter intercambiable via `WHATSAPP_DRIVER=webjs|meta` en config
- `src/adapters/inbound/meta-whatsapp-adapter.js` — usa REST API de Graph Facebook
- Envío: `POST /{phone-number-id}/messages` con token de acceso permanente
- Recepción: webhook `GET /api/meta-webhook` (verificación challenge) y `POST /api/meta-webhook` (mensajes entrantes)
- Deduplicación por `message.id` con Set rotativo (cleanup cada 60s)
- Misma interfaz que whatsapp-web.js: `{ getClient, getQrCode, handleIncoming, sendMessage }`
- Config: `META_PHONE_NUMBER_ID`, `META_ACCESS_TOKEN`, `META_VERIFY_TOKEN`

### Subdomino y HTTPS (Cloudflare + Nginx)
- `bot.synaptiqnova.online` apunta a `132.145.202.10` con Cloudflare proxy (nube naranja)
- Nginx reverse proxy: puerto 80 (HTTP) y 443 (HTTPS) → `localhost:3099`
- Certificado SSL: Cloudflare Origin CA (cubre `*.synaptiqnova.online`)
- Root `/` sirve landing page de NeoWeb Studio
- `/health` expone health check del bot

### HMAC Webhook (Issue #7)
- Middleware `verifyWebhookSignature` en express-adapter.js
- Verifica firma HMAC-SHA256 del body si el header `X-Webhook-Signature` está presente
- Si no hay header, permite el paso (compatibilidad con widget sin secret)
- Widget.js firma automáticamente via Web Crypto API cuando tiene `data-webhook-secret`
- Endpoints: `/api/meta-webhook` para webhook de Meta

## Endpoints

| Ruta | Método | Descripción |
|---|---|---|
| `/` | GET | Landing page (estilo NeoWeb Studio) |
| `/health` | GET | Health check (incluye estado de Ollama y WhatsApp) |
| `/api/status` | GET | Estado del servicio |
| `/api/webhook` | POST | Webhook para chat web (HMAC opcional) |
| `/api/meta-webhook` | GET | Verificación challenge Meta WhatsApp |
| `/api/meta-webhook` | POST | Mensajes entrantes Meta WhatsApp |
| `/api/dashboard/*` | GET | API del dashboard (stats, conversations, leads, handoffs, analytics) |
| `/dashboard` | GET | Dashboard web HTML |
| `/widget/test` | GET | Página demo del widget |
| `/widget.js` | GET | Script del widget embebible |
| `/whatsapp/qr` | GET | Página con QR para conectar WhatsApp |
| `/api/knowledge` | GET | Listar todos los documentos de la knowledge base |
| `/api/knowledge` | POST | Agregar un nuevo documento (genera embedding automáticamente) |
| `/api/knowledge/:id` | DELETE | Eliminar un documento por ID |
| `/api/knowledge/reseed` | POST | Re-sembrar la knowledge base con los documentos por defecto |

## Dashboard web (frontend modular)

El dashboard es un SPA vanilla (sin frameworks) con arquitectura hexagonal aplicada al frontend: cada capa tiene una responsabilidad única y las vistas dependen de interfaces, no de detalles de HTTP o DOM.

```
public/
├── dashboard.html                # Skeleton: sidebar + topbar + contenedores de vistas
└── dashboard/
    ├── styles.css                # Tema Material/BotPenguin (#226cf4, CSS variables)
    └── js/
        ├── api.js                # Adapter de salida (HTTP): única capa que conoce fetch/REST
        ├── format.js             # Helpers puros (esc, formatTime, badges, quotaBar) — sin DOM
        ├── ui.js                 # Componentes DOM reutilizables (modal, toast, bindActions)
        ├── views/
        │   ├── overview.js       # Resumen (métricas globales)
        │   ├── conversations.js  # Sesiones activas + modal de detalle
        │   ├── handoffs.js       # Derivaciones a humano + asignación
        │   ├── leads.js          # Leads capturados
        │   ├── clients.js        # Chatbots (AI Agents): wizard "Create Chatbot" 4 pasos + edit + servicios
        │   ├── appointments.js   # Citas agendadas
        │   └── analytics.js      # Analíticas: KPIs, canales, funnel, timeline (barras CSS puras)
        └── main.js               # Composición raíz: router de sidebar, polling de vista activa, DI
```

### Convenciones

- **Vistas**: cada vista exporta `createXView(root)` → `{ render() }`. Registran eventos vía `bindActions` (delegación con `data-action`), nunca inline handlers.
- **Estado global**: evita estado global; el wizard de clients.js usa un objeto `wizard` local al módulo.
- **Polling**: `main.js` refresca solo la vista activa cada 5s (no todas), reduciendo carga.
- **Agregar una vista nueva**: crear `views/foo.js` con `createFooView(root)`, agregar la sección `<section data-view="foo">` en `dashboard.html`, y registrarla en `VIEWS`/`TITLES` de `main.js`.

### Wizard "Create Chatbot" (estilo BotPenguin)

En la vista **Chatbots** el botón "+ Crear Chatbot" abre un wizard de 4 pasos:
1. **Select Platform** — tarjetas de plataforma (Web, WhatsApp, Telegram soportadas; Instagram/Facebook/MS Teams/SMS como "Próximamente")
2. **Usecase** — templates de industria o personalizado
3. **Setup Bot** — nombre, slug (autogenerado desde el nombre), servicios, plan, dueño
4. **Install Bot** — código del widget embebible (web) o instrucciones (WhatsApp/Telegram)

El wizard crea un tenant vía `POST /api/tenants` con `features` según la plataforma elegida.

## Cómo correr el proyecto

### Desarrollo (Docker con hot-reload)
```bash
# bind mount de src/ + node --watch para recargar en cambios
docker compose up -d
```

El archivo `docker-compose.override.yml` se carga automáticamente y configura:
- `node --watch` para recargar el servidor al editar código
- Bind mounts de `src/` y `public/` (no requiere rebuild)
- `NODE_ENV=development`, `LOG_LEVEL=debug`

### Staging
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.dev up -d
```

### Producción
```bash
# Copiar .env.prod a .env para que Docker Compose lo lea automáticamente
cp .env.prod .env
# O usar --env-file explícitamente
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.prod up -d
```

### Ambiente local sin Docker
```bash
# Requiere: PostgreSQL y Ollama instalados localmente
cp .env.example .env   # y ajustar DB_HOST=localhost
npm install
npm start
```

### Portproxy (Windows sin mirrored networking)
```powershell
netsh interface portproxy add v4tov4 listenport=3090 listenaddress=0.0.0.0 connectport=3090 connectaddress=<WSL_IP>
```

### Comandos útiles
```bash
# Ver logs en tiempo real
docker compose logs -f bot

# Reconstruir y reiniciar solo el bot (tras cambios de código)
docker compose build bot && docker compose up -d

# Ver estado de todos los servicios
docker compose ps

# Limpiar todo (borra volúmenes de datos)
docker compose down -v
```

## Cómo agregar documentos a la knowledge base

La knowledge base se puede gestionar via API REST. Cada documento debe ser texto plano descriptivo de la empresa, servicios, FAQ, etc.

### Listar documentos
```bash
curl http://localhost:3090/api/knowledge
```

### Agregar un documento
```bash
curl -X POST http://localhost:3090/api/knowledge \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Nuestro servicio de migración web incluye: transferencia de dominio, backup completo, migración de base de datos y pruebas de funcionamiento. Desde $199 USD.",
    "metadata": { "type": "service", "service": "migration" }
  }'
```

El endpoint genera automáticamente el embedding del contenido usando `nomic-embed-text` y lo guarda con el índice HNSW para búsqueda semántica.

### Eliminar un documento
```bash
curl -X DELETE http://localhost:3090/api/knowledge/<UUID>
```

### Re-sembrar documentos por defecto
```bash
curl -X POST http://localhost:3090/api/knowledge/reseed
```

Esto elimina la necesidad de editar código para mantener la base de conocimiento actualizada. Los documentos se integran automáticamente en las conversaciones via RAG.

## CI/CD con GitHub Actions

### Workflows

**CI (`.github/workflows/ci.yml`)** — Se ejecuta en cada push/PR a main/staging/develop:
1. Syntax check de todos los archivos JS (`node --check`)
2. Build de la imagen Docker

**Deploy (`.github/workflows/deploy.yml`)** — Se ejecuta al pushear a `main` o manualmente:
1. Build y push de la imagen a GitHub Container Registry (`ghcr.io`)
2. Conexión SSH al VPS
3. Pull de la nueva imagen y recreación del contenedor

### Secrets requeridos para deploy

| Secret | Descripción |
|---|---|
| `DEPLOY_HOST` | IP o dominio del VPS |
| `DEPLOY_USER` | Usuario SSH |
| `DEPLOY_SSH_KEY` | Clave privada SSH |
| `DEPLOY_PATH` | Ruta del proyecto en el VPS |

### Cómo habilitar el deploy

1. Agregar los secrets en GitHub: Settings > Secrets and variables > Actions
2. Hacer push a `main` o usar Actions > Deploy > Run workflow

## Entornos (Dev / Staging / Prod)

### Archivos de configuración

| Archivo | Propósito | Git |
|---|---|---|
| `.env.example` | Template con todas las variables documentadas | ✅ Sí |
| `.env.dev` | Defaults para desarrollo | ✅ Sí |
| `.env.staging` | Defaults para staging | ✅ Sí |
| `.env` | Desarrollo local | ❌ No |
| `.env.prod` | Producción (credenciales reales) | ❌ No |

### Docker Compose

| Archivo | Propósito |
|---|---|
| `docker-compose.yml` | Configuración base (tres servicios: postgres, ollama, bot) |
| `docker-compose.override.yml` | Dev overrides (hot-reload, bind mounts) — se carga automáticamente con `docker compose up` |
| `docker-compose.prod.yml` | Prod overrides (resource limits, restart policies, logging) |

### Comandos por entorno

```bash
# Desarrollo (override se carga solo)
docker compose up -d

# Staging
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.dev up -d

# Producción
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.prod up -d
```

### docker-compose.prod.yml

Agrega para producción:
- `restart: always` en todos los servicios
- Límites de memoria (PostgreSQL: 512M, Ollama: 4G, Bot: 1G)
- Logging rotado (10 MB por archivo, máximo 3 archivos)
- `NODE_ENV=production`, `LOG_LEVEL=info`
