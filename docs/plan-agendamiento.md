# Plan de Desarrollo — Agendamiento Automático con Google Calendar

## Resumen

Agregar agendamiento automático de citas/reuniones al Bot IA HubSpot usando Google Calendar API. El agente conversacional detectará intención de agendar, propondrá horarios disponibles y confirmará la cita. Todo respetando la arquitectura hexagonal existente.

---

## Semana 1 — Infraestructura base

### 1.1 Dependencia nueva

```bash
npm install googleapis
```

### 1.2 Configuración (`.env.example` + `config.js`)

```env
# Google Calendar
GOOGLE_CLIENT_EMAIL=bot-scheduler@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GOOGLE_CALENDAR_ID=primary
BUSINESS_TIMEZONE=America/Argentina/Buenos_Aires
MEETING_DURATION_MINUTES=30
```

Agregar bloque `calendar` en `config.js`:

```js
calendar: {
  clientEmail: process.env.GOOGLE_CLIENT_EMAIL || '',
  privateKey: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary',
  timezone: process.env.BUSINESS_TIMEZONE || 'America/Argentina/Buenos_Aires',
  meetingDuration: parseInt(process.env.MEETING_DURATION_MINUTES, 10) || 30,
},
```

### 1.3 Puerto `CalendarProvider` (`src/ports/calendar-provider.js`)

```js
/**
 * CalendarProvider port
 *
 * getAvailability(date) → [{ start, end }]         — slots libres para ese día
 * bookAppointment(lead, datetime, duration) → event — crea evento + invitación
 * getScheduledAppointments(email) → events[]         — citas ya agendadas del lead
 * checkHealth() → { available }
 */
```

### 1.4 Adaptador `google-calendar-provider.js` (`src/adapters/outbound/google-calendar-provider.js`)

- Usa **service account** con `google.auth.JWT` (no OAuth2 de usuario final)
- Métodos:
  - `getAvailability(date)`: consulta `freebusy` y devuelve slots disponibles en horario comercial (09:00–18:00)
  - `bookAppointment(name, email, datetime, duration)`: crea `calendar.events.insert` con Google Meet, invitación al lead, resumen = `"Reunión con NeoWeb Studio - {name}"`
  - `getScheduledAppointments(email)`: busca eventos donde el lead es attendee
  - `checkHealth()`: verifica conexión con Google Calendar API

### 1.5 Tabla `appointments` en PostgreSQL (`postgres-store.js`)

Agregar a la migración:

```sql
CREATE TABLE IF NOT EXISTS appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  contact_email TEXT NOT NULL,
  contact_name TEXT,
  contact_phone TEXT,
  google_event_id TEXT UNIQUE,
  service_interest TEXT,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  status TEXT DEFAULT 'confirmed' CHECK (status IN ('pending', 'confirmed', 'cancelled', 'no_show')),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_appointments_start_time ON appointments(start_time);
CREATE INDEX IF NOT EXISTS idx_appointments_contact_email ON appointments(contact_email);
```

Métodos nuevos en el store:

```js
saveAppointment(data) → row
getAppointmentsByEmail(email) → rows[]
getUpcomingAppointments(limit) → rows[]
cancelAppointment(id) → void
```

---

## Semana 2 — Lógica de agendamiento

### 2.1 Entidad `Appointment` (`src/domain/entities.js`)

```js
function Appointment({ id, contactEmail, contactName, contactPhone,
  googleEventId, serviceInterest, startTime, endTime, status = 'confirmed' }) {
  if (!id) id = crypto.randomUUID();
  return Object.freeze({ id, contactEmail, contactName, contactPhone,
    googleEventId, serviceInterest, startTime, endTime, status });
}
```

### 2.2 Función `proposeTimeSlots` (`src/domain/use-cases.js`)

Lógica para formatear slots disponibles en texto amigable:

```
"Estos son los horarios libres para mañana:
A) 10:00 AM
B) 14:30 PM
C) 16:00 PM
¿Cuál te queda mejor?"
```

### 2.3 Caso de uso `handleScheduling` (`src/domain/use-cases.js`)

Flujo:

```
1. Extraer fecha/hora del mensaje del usuario (con ayuda de la IA)
   → Si la IA detecta intención de agendar pero no hay fecha: consultar disponibilidad y proponer slots
   
2. Si hay fecha concreta:
   a. Verificar disponibilidad con calendar.getAvailability(fecha)
   b. Si está libre: confirmar con el usuario → "¿Confirmo la reunión para el martes 15 a las 15:00?"
   c. Si está ocupado: proponer alternativas cercanas

3. Si el usuario confirma:
   a. calendar.bookAppointment(name, email, datetime, duration)
   b. store.saveAppointment(data)
   c. Enviar confirmación: "¡Listo! Te envié la invitación a tu calendario. Nos vemos el {fecha}."

4. Si cancela o pide cambiar:
   a. cancelAppointment(id)
   b. Volver al paso 1
```

### 2.4 Prompt del LLM (`ollama-provider.js`)

Agregar al system prompt:

```
## AGENDAMIENTO
Si el cliente quiere agendar una reunión, extrae en [LEAD_DATA]:
- intent: "schedule"
- scheduling: { action: "request_availability" | "confirm_slot" | "cancel", 
    preferred_date: "YYYY-MM-DD" | null, preferred_time: "HH:MM" | null }

Ejemplo de respuesta cuando el cliente quiere agendar:
"Claro, déjame revisar la disponibilidad..."
[LEAD_DATA] { "intent": "schedule", "detected_service": "web_development", 
  "lead": { ... }, "scheduling": { "action": "request_availability",
    "preferred_date": null, "preferred_time": null }, "confidence": 0.9 } [/LEAD_DATA]
```

### 2.5 Integración en `handleMessage` (`src/domain/use-cases.js`)

Modificar el flujo principal para detectar `intent === 'schedule'` y delegar al nuevo caso de uso:

```js
// Después de obtener leadData del AI provider:
if (leadData.intent === 'schedule' && deps.calendar) {
  return await handleScheduling({
    session, leadData, message, store, ai, calendar: deps.calendar, from
  });
}
```

---

## Semana 3 — Endpoints y chat widget

### 3.1 API Endpoints (`express-adapter.js`)

```js
GET  /api/availability?date=YYYY-MM-DD
  // → { date, timezone, slots: [{ start, end }] }

POST /api/appointments
  // Body: { email, name, phone, datetime, serviceInterest }
  // → { appointment, googleEventLink }
  // (para booking directo desde widget)

GET  /api/appointments?email=cliente@email.com
  // → [{ id, start_time, end_time, status, ... }]

DELETE /api/appointments/:id
  // → { success: true }
```

### 3.2 Chat Widget (`public/widget.js`)

Agregar **selector de fecha/hora** nativo (sin dependencias externas):

Cuando el bot responde con slots disponibles, mostrar botones inline:

```js
// Formato de respuesta especial del bot:
// "__SLOTS__[{"label":"10:00 AM","value":"2026-08-01T10:00:00-03:00"}]
function renderSlotButtons(slots) {
  // Crear botones clickeables debajo del mensaje del bot
  slots.forEach(slot => {
    var btn = document.createElement('button');
    btn.textContent = slot.label;
    btn.onclick = () => confirmSlot(slot.value);
    messagesEl.appendChild(btn);
  });
}
```

### 3.3 Respuesta estructurada para slots

El bot devolverá metadata en `leadData.actions`:

```json
{
  "intent": "schedule",
  "scheduling": {
    "action": "propose_slots",
    "slots": [
      { "label": "10:00 AM", "value": "2026-08-01T13:00:00Z" },
      { "label": "14:30 PM", "value": "2026-08-01T17:30:00Z" }
    ]
  }
}
```

El widget parsea esto y renderiza botones.

---

## Semana 4 — Integración, tests y deploy

### 4.1 DI en `app.js`

```js
const { createCalendarProvider } = require('./adapters/outbound/google-calendar-provider');
const calendar = createCalendarProvider();

const deps = { store, ai, crm, calendar, handleMessage };
```

### 4.2 Tests (`__tests__/`)

| Archivo | Qué testea |
|---|---|
| `domain/scheduling.test.js` | `proposeTimeSlots`, `handleScheduling`, detección de fechas |
| `adapters/google-calendar-provider.test.js` | Mock de Google Calendar API, `getAvailability`, `bookAppointment` |
| `adapters/express-adapter.test.js` | Nuevos endpoints: `GET /api/availability`, `POST /api/appointments` |
| `domain/use-cases.test.js` | Integración de scheduling en `handleMessage` |

### 4.3 Knowledge base seed

Agregar documentos de conocimiento sobre agendamiento:

```js
{ content: 'Agendamiento: Ofrecemos reuniones de 30 minutos de lunes a viernes de 9:00 a 18:00 hora Argentina. Si necesitás otro horario, consultanos.', metadata: { type: 'scheduling' } },
{ content: 'Para agendar una reunión necesitamos tu nombre, email y el servicio que te interesa. La reunión es por Google Meet y te llega la invitación automática a tu calendario.', metadata: { type: 'scheduling_process' } },
```

### 4.4 `docker-compose.yml`

No requiere cambios. Google Calendar se consume via API externa.

### 4.5 `.env.example` actualizado

Agregar bloque `Google Calendar` con las 5 variables nuevas.

---

## Resumen de archivos a crear/modificar

| Acción | Archivo |
|---|---|
| **Nuevo** | `src/ports/calendar-provider.js` |
| **Nuevo** | `src/adapters/outbound/google-calendar-provider.js` |
| **Nuevo** | `__tests__/domain/scheduling.test.js` |
| **Nuevo** | `__tests__/adapters/google-calendar-provider.test.js` |
| **Modificar** | `src/config.js` (+ bloque `calendar`) |
| **Modificar** | `src/domain/entities.js` (+ `Appointment`) |
| **Modificar** | `src/domain/use-cases.js` (+ `proposeTimeSlots`, `handleScheduling`, integración) |
| **Modificar** | `src/ports/ai-provider.js` (documentar scheduling en comment) |
| **Modificar** | `src/adapters/outbound/ollama-provider.js` (+ scheduling en prompt) |
| **Modificar** | `src/adapters/outbound/postgres-store.js` (+ tabla `appointments`, +6 métodos) |
| **Modificar** | `src/adapters/inbound/express-adapter.js` (+4 endpoints) |
| **Modificar** | `src/app.js` (+ calendar DI, + seed docs) |
| **Modificar** | `public/widget.js` (+ slot buttons renderer) |
| **Modificar** | `.env.example` (+5 vars) |
| **Modificar** | `package.json` (+ `googleapis`) |
| **Modificar** | `__tests__/adapters/express-adapter.test.js` (+ scheduling endpoints) |
| **Modificar** | `__tests__/domain/use-cases.test.js` (+ scheduling flows) |

**Total: 5 archivos nuevos, 12 modificados.**

---

## Flujo completo post-implementación

```
Usuario: "Quiero agendar una reunión"
  ↓
AI detecta intent="schedule", scheduling.action="request_availability"
  ↓
handleMessage → handleScheduling
  ↓
calendar.getAvailability("mañana") → [10:00, 14:30, 16:00]
  ↓
Bot responde: "Estos son los horarios disponibles mañana: A) 10:00, B) 14:30, C) 16:00. ¿Cuál preferís?"
  ↓ (con leadData.actions con los slots)
  ↓
Widget renderiza 3 botones clickeables
  ↓
Usuario clickea "14:30"
  ↓
calendar.bookAppointment("Juan", "juan@email.com", "2026-08-01T17:30:00Z", 30)
  ↓
Google Calendar crea evento + Google Meet + invitación por email
  ↓
store.saveAppointment({ ... })
  ↓
Bot responde: "¡Listo Juan! Te envié la invitación a juan@email.com. Nos vemos el viernes 1 de agosto a las 14:30 por Google Meet."
  ↓
HubSpot: se registra contact + deal con stage "appointmentscheduled" (ya existente)
```

---

## Costos y requisitos

| Concepto | Detalle |
|---|---|
| Google Calendar API | Gratis (1M queries/día) |
| Service Account | Se crea en Google Cloud Console (1 vez) |
| Dependencia npm | `googleapis` (~3 MB) |
| Impacto en rendimiento | ~200ms extra por llamada a Google API |
| Sin cambios en Docker | La API es externa, no requiere nuevo contenedor |

---

## Prioridad de features dentro del plan

| # | Feature | Semana |
|---|---|---|
| P1 | Google Calendar adapter + tabla appointments | 1 |
| P1 | Prompt scheduling + `handleScheduling` | 2 |
| P2 | API endpoints (`/api/availability`, `/api/appointments`) | 3 |
| P2 | Widget slot buttons | 3 |
| P3 | Tests | 4 |
| P3 | Knowledge seed + docs | 4 |
