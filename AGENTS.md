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
| Base de datos | PostgreSQL 16 | ✅ Implementado |
| LLM local | Ollama (Llama 3 / Mistral) | ✅ Implementado |
| CRM | HubSpot (OAuth2 + refresh tokens) | ✅ Implementado |
| WhatsApp | whatsapp-web.js (sesión persistente) | ✅ Implementado |
| Chat web | Widget JS embebible (pendiente) | 🔜 Issue #4 |
| Infraestructura | Docker Compose | ✅ Implementado |
| CI/CD | GitHub Actions | 🔜 Issue #9 |

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
ai-agent.generateResponse() → llama a Ollama con prompt + historial
        ├→ LLM genera respuesta + bloque JSON [LEAD_DATA]
        └→ extrae: intent, lead (name/email/phone/service_interest), confidence
        ↓
session.addMessage('assistant', respuesta) → persiste respuesta
        ↓
¿intent === 'lead' && email?
  ├→ Sí → hubspot.getOrCreateContact() → registra en HubSpot
  │        → contacts INSERT/UPDATE en PostgreSQL
  │        → updateSessionContext con hubspotContactId
  └→ No → responde sin registro
        ↓
Envía respuesta al canal origen
```

### Prompt del agente IA (ollama-provider.js)

El system prompt define al agente como asesor comercial de `NeoWeb Studio` con:

- **Servicios**: landing pages ($299+), desarrollo web ($799+), automatización ($499+)
- **Flujo de ventas**: presentación → preguntar necesidad → proponer → agendar
- **Estrategia**: upselling, urgencia, cierre
- **Salida estructurada**: bloque `[LEAD_DATA]` con JSON que el backend parsea

El prompt es dinámico y toma la configuración de `BUSINESS_NAME` y `BUSINESS_SERVICES` del `.env`.

## Base de datos (PostgreSQL)

### Tablas

**sessions** — Sesiones conversacionales
- `id` UUID PRIMARY KEY
- `channel` TEXT (whatsapp|web)
- `phone` TEXT (para reanudar sesión)
- `context` JSONB (datos extraídos del lead)
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

## Roadmap (Issues)

| # | Issue | Prioridad | Estado |
|---|---|---|---|
| 1 | Dashboard web para monitorear conversaciones | Media | 📝 Pendiente |
| 2 | Meta WhatsApp Business API (alternativa producción) | Alta | 📝 Pendiente |
| 3 | Tests automatizados (Jest, unitarios + integración) | Alta | 📝 Pendiente |
| 4 | Widget de chat web embebible para landing pages | Alta | 📝 Pendiente |
| 5 | Creación automática de deals en HubSpot | Media | 📝 Pendiente |
| 6 | Analíticas de conversión y métricas | Media | 📝 Pendiente |
| 7 | Verificación de firmas HMAC en webhooks | Alta | 📝 Pendiente |
| 8 | Soporte multilingüe (inglés, portugués) | Baja | 📝 Pendiente |
| 9 | CI/CD con GitHub Actions | Alta | 📝 Pendiente |
| 10 | Configuración de entornos (dev/staging/prod) | Alta | 📝 Pendiente |

## Decisiones técnicas

### ¿Por qué Ollama local en vez de OpenAI?
El usuario solicitó modelo local (Llama 3 / Mistral) para evitar costos recurrentes de API y tener control total de los datos.

### ¿Por qué whatsapp-web.js en vez de Meta API?
whatsapp-web.js es gratuito y no requiere aprobación de Meta. Para producción a escala está previsto migrar a Meta WhatsApp Business API (Issue #2) usando el patrón strategy.

### ¿Por qué OAuth2 en vez de Private App Token?
Los tokens de Private App expiran. OAuth2 con refresh token permite token renewal automático sin intervención manual.

### ¿Por qué PostgreSQL en vez de SQLite?
El usuario solicitó PostgreSQL para producción. Las sesiones y mensajes requieren concurrencia y fiabilidad que PostgreSQL ofrece.

## Endpoints

| Ruta | Método | Descripción |
|---|---|---|
| `/health` | GET | Health check (incluye estado de Ollama y WhatsApp) |
| `/api/status` | GET | Estado del servicio |
| `/api/webhook` | POST | Webhook para chat web o integraciones externas |
| `/auth/hubspot` | GET | Inicia flujo OAuth con HubSpot |
| `/oauth/callback` | GET | Callback OAuth de HubSpot |
| `/whatsapp/qr` | GET | Obtiene QR code para conectar WhatsApp |

## Cómo correr el proyecto

### Desarrollo local
```bash
# Requiere: PostgreSQL y Ollama corriendo
npm install
npm start
```

### Producción (Docker)
```bash
docker compose up -d
# Escanea el QR: curl http://localhost:3000/whatsapp/qr
# Autentica HubSpot: visita http://localhost:3000/auth/hubspot
```
