# Documento de Arquitectura — Bot IA HubSpot

## 1. Visión General

Bot comercial multicanal que captura leads desde anuncios en redes sociales, los califica con IA local via WhatsApp o web widget, y los registra automaticamente en HubSpot CRM.

```
Anuncio (Instagram/Facebook/TikTok/X)
  ├→ Click a WhatsApp → Bot atiende → Lead a HubSpot
  └→ Click a Landing Page → Widget web → Bot atiende → Lead a HubSpot
```

---

## 2. Stack Tecnologico

| Componente | Tecnologia | Justificacion |
|---|---|---|
| Backend | Node.js + Express | Runtime liviano, ideal para I/O asincrono (WhatsApp, HTTP, DB). Unico lenguaje en todo el stack. |
| Base de datos | PostgreSQL 16 + pgvector | Concurrencia real, JSONB para contextos flexibles, integridad transaccional, extension vectorial nativa. |
| Vector DB | pgvector + nomic-embed-text | Embeddings de 768d en la misma DB transaccional. Indice HNSW para busquedas por similitud coseno. |
| LLM | Ollama + llama3.2:3b | Modelo local: sin costos de API, datos nunca salen del servidor, latencia aceptable (5-15s en CPU). |
| Embeddings | Ollama + nomic-embed-text | Modelo de 274MB, 768 dimensiones, corre en CPU, calidad semantica suficiente para dominio acotado. |
| CRM | HubSpot Service Key | Token directo sin flujo OAuth. Permisos: contacts.read/write, deals.write. |
| WhatsApp | whatsapp-web.js | Gratuito, sin aprobacion de Meta. Para produccion esta prevista la migracion a Meta Business API. |
| Contenedores | Docker Compose | Entorno reproducible, mismo stack en dev y prod, aislamiento por servicio. |
| Infraestructura | WSL2 + Windows | Desarrollo local sin servidor cloud. Portproxy NAT para acceso desde Windows. |

---

## 3. Arquitectura Hexagonal (Ports & Adapters)

El proyecto sigue arquitectura hexagonal para mantener el dominio limpio de dependencias externas.

### Estructura

```
src/
├── domain/        # Logica de negocio pura (cero imports externos)
├── ports/         # Interfaces/contratos
├── adapters/
│   ├── inbound/   # Reciben input (HTTP, WhatsApp)
│   └── outbound/  # Conectan con externos (DB, Ollama, HubSpot)
├── config.js      # Config centralizada
├── app.js         # Punto de inyeccion de dependencias
└── server.js      # Entry point
```

### Principio

- **Domain** nunca importa nada del exterior. Solo recibe dependencias por parametro.
- **Ports** definen contratos (interfaces) que los adapters deben cumplir.
- **Adapters** implementan los contratos. Son intercambiables sin tocar el dominio.

### Inyeccion de Dependencias

```
app.js
  ├→ postgres-store.js   → store
  ├→ ollama-provider.js   → ai
  ├→ hubspot-provider.js  → crm
  └→ use-cases.js         → handleMessage(deps)
                                ↓
                       express-adapter(deps)
                       whatsapp-adapter(deps)
```

---

## 4. Flujo del Mensaje (con RAG)

```
Mensaje entrante (WhatsApp o Webhook)
        ↓
getOrCreateSession() → busca sesion activa por telefono
        ↓
addMessage('user', mensaje) → persiste
        ↓
getConversationHistory() → ultimos 20 mensajes
        ↓
getMemory() → recupera datos previos del cliente
        ↓
generateEmbedding(mensaje) → nomic-embed-text → vector 768d
        ↓
searchKnowledge(embedding, 3) → pgvector cosine similarity → top-3 docs
        ↓
generateResponse(prompt + historial + memoria + knowledgeDocs)
        ├→ Ollama genera respuesta + bloque JSON [LEAD_DATA]
        └→ extrae: intent, lead(name/email/phone/service), confidence
        ↓
addMessage('assistant', respuesta) → persiste
        ↓
upsertMemory() → guarda datos nuevos del lead
        ↓
¿intent === 'lead' && email?
  ├→ Si → getOrCreateContact() → Lead en HubSpot
  │        → createDeal() → Deal en pipeline
  │        → saveContact() → Lead en PostgreSQL
  └→ No → responde sin registro
        ↓
Envia respuesta al canal origen
```

---

## 5. RAG (Retrieval Augmented Generation)

### 5.1 ¿Que es?

Sistema que busca documentos relevantes (servicios, FAQ, procesos) en una base vectorial y los inyecta en el prompt del LLM para que el bot responda con informacion actualizada sin hardcodearla en el system prompt.

### 5.2 Arquitectura del RAG

```
Mensaje del usuario
        ↓
[1] Ollama: /api/embeddings
    Modelo: nomic-embed-text (274MB)
    Output: vector de 768 dimensiones (Float32[])
        ↓
[2] PostgreSQL: knowledge table
    Indice HNSW con vector_cosine_ops
    Query: SELECT content, 1 - (embedding <=> $vector) as similarity
    WHERE embedding IS NOT NULL
    ORDER BY embedding <=> $vector LIMIT 3
        ↓
[3] Top-3 documentos con mayor similitud coseno
        ↓
[4] Inyeccion en system prompt:
    ## INFORMACIÓN DE LA EMPRESA
    1. {doc.content}
    2. {doc.content}
    3. {doc.content}
    Usa esta información para dar respuestas precisas...
        ↓
[5] Ollama: /api/chat con prompt completo
    Modelo: llama3.2:3b
```

### 5.3 Modelo de Embeddings: nomic-embed-text

| Propiedad | Valor |
|---|---|
| Modelo | nomic-embed-text |
| Tamaño | 274 MB |
| Dimensiones | 768 |
| Velocidad | ~50ms por embedding en CPU moderna |
| Calidad | Suficiente para dominio acotado (servicios web, FAQ) |
| API | `/api/embeddings` de Ollama |

### 5.4 Indice Vectorial: pgvector HNSW

```sql
CREATE INDEX idx_knowledge_embedding
  ON knowledge USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

| Parametro | Valor | Efecto |
|---|---|---|
| `m` | 16 | Maximo de conexiones por nodo (mayor = mas recall, mas memoria) |
| `ef_construction` | 64 | Tamaño de la lista de exploracion durante construccion |
| Operador | `vector_cosine_ops` | Distancia coseno para similitud semantica |
| Tipo de indice | HNSW | Hierarchical Navigable Small World — busqueda sub-segundo en miles de docs |

### 5.5 Semilla de Conocimiento (KNOWLEDGE_SEED)

En `app.js` se definen 10 documentos iniciales que se cargan automaticamente al iniciar el servidor si la tabla esta vacia:

| Tipo | Cantidad | Proposito |
|---|---|---|
| company_info | 1 | Descripcion de NeoWeb Studio |
| service | 3 | Landing pages, desarrollo web, automatizacion (con precios) |
| faq | 2 | Dominio/hosting, mantenimiento |
| process | 1 | Flujo de trabajo |
| social_proof | 1 | Casos de exito |
| differentiator | 1 | Diferenciador (IA local) |
| guarantee | 1 | Garantia post-entrega |

### 5.6 Injection en el Prompt

El system prompt se construye dinamicamente con 3 bloques variables:

```
Eres un asesor comercial experto de {business.name}...

## INFORMACIÓN DEL CLIENTE (conversaciones previas)
- contact_name: {memory.contact_name}
- service_interest: {memory.service_interest}
Usa esta informacion para no preguntar datos que ya te dieron.

## INFORMACIÓN DE LA EMPRESA (usa esto para responder con precision)
1. Servicio: Landing Pages. Desde $299 USD...
2. Pregunta frecuente: ¿Ofrecen mantenimiento?...
Usa esta informacion para dar respuestas precisas sobre servicios,
precios y procesos. No inventes informacion que no este aqui.

## TU PERSONALIDAD
...
## REGLA CRITICA: DERIVACION A HUMANO
...
## FORMATO
...
[LEAD_DATA] { ... } [/LEAD_DATA]
```

### 5.7 Beneficios del RAG

- **Informacion actualizada**: Los documentos se actualizan via API sin modificar codigo
- **Precision**: El LLM responde con datos factuales en lugar de alucinar
- **Escalable**: Indice HNSW permite miles de documentos sin degradacion
- **Sin costo adicional**: Misma infraestructura (Ollama + PostgreSQL)

---

## 6. Decisiones Tecnicas Explicadas

### 6.1 ¿Por que Ollama local y no OpenAI?

**Contexto:** OpenAI cobra por token (~$0.01 por conversacion tipica). En volumen alto (1000 leads/mes) son ~$10/mes solo en API.

**Decision:** Modelo local con Ollama.

**Implicaciones:**
- Costo cero operativo de IA
- Datos 100% controlados (no salen del servidor)
- Sin dependencia de internet para inferencia
- Contrapartida: CPU-bound, mas lento que API cloud

**Modelo elegido:** Iniciamos con `llama3:latest` (8B, ~4.7GB, 30-120s por respuesta en CPU). Migramos a `llama3.2:3b` (~2GB, 5-15s) por rendimiento. La calidad es suficiente para el caso de uso (extraer leads, no razonamiento complejo).

### 6.2 ¿Por que whatsapp-web.js y no Meta API?

**Contexto:** Meta WhatsApp Business API requiere aprobacion de Meta, configuracion de webhook, numero de telefono verificado, y puede tomar semanas.

**Decision:** whatsapp-web.js (cliente no oficial que automatiza WhatsApp Web).

**Implicaciones:**
- Gratuito, configuracion inmediata
- Escanea QR y funciona
- **Riesgo:** Puede dejar de funcionar si Meta bloquea el cliente no oficial
- **Plan:** Migrar a Meta Business API (Issue #2) cuando el proyecto escale

### 6.3 ¿Por que Service Key (access token) y no OAuth2?

**Contexto:** HubSpot ofrece dos formas de autenticacion: OAuth2 (con refresh tokens) y Service Key (token directo).

**Decision:** Service Key por simplicidad.

**Implicaciones:**
- Token directo, no expira
- No requiere flujo OAuth ni refresh tokens
- Menos codigo, menos puntos de fallo
- Suficiente para un unico tenant

### 6.4 ¿Por que PostgreSQL y no SQLite?

**Contexto:** SQLite es mas simple (archivo unico), PostgreSQL requiere servidor.

**Decision:** PostgreSQL 16.

**Implicaciones:**
- Concurrencia real (varias sesiones simultaneas)
- JSONB para almacenar contextos flexibles de sesion
- Indices para busquedas por telefono
- Extension `vector` (pgvector) para RAG
- Preparado para produccion desde el dia 1

### 6.5 ¿Por que Docker Compose?

**Contexto:** La app tiene 3 servicios (bot, postgres, ollama) que deben correr juntos.

**Decision:** Docker Compose.

**Implicaciones:**
- Un solo comando: `docker compose up -d`
- Entorno identico en dev y prod
- Aislamiento de dependencias (no instalar Postgres en la maquina host)
- Facil escalado horizontal

### 6.6 ¿Por que redes NAT y no mirrored networking?

**Contexto:** WSL2 ofrece networkingMode=mirrored (comparte stack de red con Windows) y NAT default.

**Decision inicial:** mirrored (evita portproxy). **Problema:** Con mirrored, Docker al bindear puertos en 0.0.0.0 interferia con el stack de red de Windows, causando caida del WiFi.

**Solucion:** NAT default + portproxy:
```
netsh interface portproxy add v4tov4 listenport=3090 connectport=3090 connectaddress=<WSL_IP>
```

### 6.7 ¿Por que nomic-embed-text para embeddings?

**Alternativas:** OpenAI embeddings (costo recurrente), sentence-transformers (requiere Python), ChromaDB (servicio adicional).

**Decision:** nomic-embed-text via Ollama.

**Implicaciones:**
- Modelo pequeno (274 MB) que corre en CPU
- 768 dimensiones: balance entre precision y rendimiento
- Misma API de Ollama que el LLM principal
- Sin servicios adicionales ni costos de API

### 6.8 ¿Por que pgvector y no base vectorial dedicada?

**Alternativas:** ChromaDB, Qdrant, Pinecone.

**Decision:** pgvector como extension de PostgreSQL.

**Implicaciones:**
- Un solo stack de datos (PostgreSQL)
- Indice HNSW nativo con busqueda coseno
- Sin servicio adicional que monitorear
- Backups atomicos de datos + embeddings

---

## 7. Memoria Persistente (Key-Value Memory)

### Que es

Sistema que extrae hechos clave de cada conversacion y los guarda en el contexto de la sesion (JSONB en PostgreSQL). En conversaciones futuras, esos hechos se reinyectan en el prompt del LLM.

### Implementacion

1. **Extraccion:** Despues de cada respuesta de Ollama, se parsea el bloque `[LEAD_DATA]` y se extraen: nombre, email, telefono, servicio interesado.
2. **Almacenamiento:** Se guardan en `session.context.memory` como key-value:
   ```json
   {
     "memory": {
       "contact_name": "Mauricio",
       "contact_email": "m@ejemplo.com",
       "service_interest": "desarrollo web"
     }
   }
   ```
3. **Reinyeccion:** En la siguiente llamada a Ollama, se agrega un bloque al system prompt:
   ```
   ## INFORMACION DEL CLIENTE (conversaciones previas)
   - contact_name: Mauricio
   - service_interest: desarrollo web
   Usa esta informacion para no preguntar datos que ya te dieron.
   ```

### Diferencia con RAG

La memoria key-value recuerda **datos del cliente** de la conversacion actual. El RAG busca **documentos de la empresa** relevantes a la consulta. Ambos se combinan en el prompt.

---

## 8. Mejoras a Futuro Explicadas

### 8.1 Fine-tuning del modelo

**Que es:** Entrenar el modelo con conversaciones reales exitosas para que aprenda el tono, estilo y flujo de ventas especifico del negocio.

**Por que ahora no:** Requiere GPU (al menos 8GB VRAM), recopilar dataset de conversaciones, y proceso de fine-tuning que puede tomar horas.

**Diferencia con prompts:** El prompt es instruccion written, el fine-tuning cambia los pesos del modelo. Un modelo fine-tuned sigue las instrucciones implicitamente sin necesidad de prompts extensos.

### 8.2 Cache de respuestas

**Que es:** Almacenar respuestas a preguntas frecuentes para servirlas instantaneamente sin llamar a Ollama.

**Por que ahora no:** Cada negocio tiene diferentes FAQs. Habria que implementar un sistema de cache por similitud semantica (usando embeddings) que detecte cuando una pregunta nueva es equivalente a una ya respondida.

### 8.3 Meta WhatsApp Business API

**Que es:** API oficial de Meta para enviar/recibir mensajes de WhatsApp. Reemplaza whatsapp-web.js.

**Por que ahora no:** Requiere:
- Numero de telefono verificado
- Aprobacion de Meta (puede tomar semanas)
- Configuracion de webhook con SSL
- Costo de ~$0.005 por mensaje

**Cuando hacerlo:** Cuando el bot procese mas de 100 leads/dia y se necesite estabilidad de produccion.

### 8.4 Analiticas de conversion

**Que es:** Dashboard con metricas: leads por canal, tasa de conversion, ROI por campana, tiempo promedio de atencion.

**Estado actual:** El dashboard muestra stats basicas (sesiones activas, mensajes 24h, total leads). Falta tracking de origen (utm_source, campana).

### 8.5 Soporte Multilingue

**Que es:** Detectar el idioma del usuario (es, en, pt) y responder en ese idioma.

**Como se haria:** El system prompt incluiria instrucciones de deteccion de idioma. El modelo llama3.2 soporta multi-idioma naturalmente. Solo requiere ajustar el prompt y los textos del widget.

---

## 9. Troubleshooting Conocido

### 9.1 Chromium Lock

**Sintoma:** `The profile appears to be in use by another Chromium process`

**Causa:** whatsapp-web.js crea archivos de lock (`SingletonLock`) en el volumen de sesion. Al reiniciar el contenedor, esos archivos quedan.

**Solucion:** El entrypoint del contenedor ejecuta:
```bash
rm -rf /tmp/org.chromium.Chromium.*
find /app/whatsapp-session -name 'Singleton*' -delete
find /app/whatsapp-session -name 'LOCK' -delete
```

### 9.2 WiFi se cae con mirrored networking

**Sintoma:** Al iniciar Docker en WSL con `networkingMode=mirrored`, el WiFi de Windows se desconecta.

**Causa:** Docker bindea puertos en 0.0.0.0 dentro del namespace compartido de WSL/Windows, interfiriendo con el stack de red.

**Solucion:** Usar NAT default + portproxy en vez de mirrored.

### 9.3 Ollama timeout

**Sintoma:** `timeout of 120000ms exceeded`

**Causa:** Modelo llama3 8B tarda >120s en CPU. Con llama3.2:3b el tiempo baja a 5-15s.

**Solucion:** Usar modelo mas pequeno o timeout mas largo.

---

## 10. Modelo de Datos

### sessions
| Columna | Tipo | Descripcion |
|---|---|---|
| id | UUID PK | Identificador unico |
| channel | TEXT | whatsapp | web |
| phone | TEXT | Numero o ID de visitante |
| contact_id | TEXT | ID de HubSpot |
| context | JSONB | Memoria persistente, handoff data |
| is_active | BOOLEAN | Sesion activa |
| created_at | TIMESTAMPTZ | Fecha creacion |
| updated_at | TIMESTAMPTZ | Ultima actividad |

### messages
| Columna | Tipo | Descripcion |
|---|---|---|
| id | UUID PK | Identificador unico |
| session_id | UUID FK | Sesion padre |
| role | TEXT | user | assistant | system |
| content | TEXT | Contenido del mensaje |
| metadata | JSONB | lead_data, handoff flags |
| created_at | TIMESTAMPTZ | Fecha del mensaje |

### contacts
| Columna | Tipo | Descripcion |
|---|---|---|
| id | UUID PK | Identificador unico |
| hubspot_id | TEXT UNIQUE | ID en HubSpot |
| name | TEXT | Nombre |
| email | TEXT UNIQUE | Email |
| phone | TEXT | Telefono |
| last_interaction | TIMESTAMPTZ | Ultima actividad |
| created_at | TIMESTAMPTZ | Fecha creacion |

### knowledge
| Columna | Tipo | Descripcion |
|---|---|---|
| id | UUID PK | Identificador unico |
| content | TEXT | Contenido del documento |
| metadata | JSONB | Tipo, servicio asociado, etc. |
| embedding | vector(768) | Vector generado por nomic-embed-text |
| created_at | TIMESTAMPTZ | Fecha de creacion |

Indice: `USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)`

---

## 11. API Endpoints

### Knowledge Base

| Metodo | Ruta | Descripcion |
|---|---|---|
| GET | `/api/knowledge` | Lista todos los documentos de conocimiento |
| POST | `/api/knowledge` | Agrega un nuevo documento (genera embedding y lo persiste) |
| DELETE | `/api/knowledge/:id` | Elimina un documento por su UUID |
| POST | `/api/knowledge/reseed` | Re-sembra los 10 documentos por defecto desde `KNOWLEDGE_SEED` |

**POST /api/knowledge** — Body:
```json
{
  "content": "Texto del documento...",
  "metadata": { "type": "service", "service": "landing_page" }
}
```

El endpoint genera el embedding llamando a `Ollama /api/embeddings` con el modelo `nomic-embed-text`, luego inserta en PostgreSQL con el vector y el indice HNSW.
