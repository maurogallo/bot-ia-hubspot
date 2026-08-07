# Plan de Trabajo — Bot IA HubSpot v3.0

## Objetivo

Superar a competidores (BotPenguin, Authkey, WATI) ofreciendo un bot multi-tenant con IA de calidad, templates por industria, Meta Business API oficial, y billing automatizado para revendedores.

---

## Diagnóstico Actual

### ✅ Lo que ya está en producción
- Multi-tenant (tenants, planes, feature gating)
- Widget web + WhatsApp (web.js + Meta API)
- HubSpot CRM nativo (contactos + deals)
- Google Calendar scheduling
- Knowledge base (pgvector + RAG)
- Dashboard con clientes, citas, quotas
- Gemini/Groq/Ollama con fallback
- Extracción de datos por regex del mensaje

### ⚠️ Bugs activos
- Servicios dinámicos del tenant no cargan en el prompt (muestra defaults)
- Flujo nombre→email→teléfono→agendar se salta pasos
- JSON del LLM a veces se muestra en el chat
- Widget muestra "NeoWeb Studio" en vez del nombre del tenant

---

## Comparación Competitiva

| Capacidad | Nosotros | BotPenguin | Authkey | WATI |
|---|---|---|---|---|
| IA conversacional | Groq + Ollama | ChatGPT | ❌ | ❌ |
| Multi-tenant | ✅ | ✅ white-label | ✅ | ❌ |
| CRM nativo | ✅ HubSpot | ❌ Zapier | ❌ | ❌ |
| Agendamiento | ✅ Google Calendar | ✅ básico | ❌ | ❌ |
| RAG / Knowledge | ✅ pgvector | ✅ | ❌ | ❌ |
| Templates industria | ❌ | ✅ | ❌ | ❌ |
| Meta Business Provider | ❌ | ✅ | ✅ | ✅ |
| Billing automático | ❌ | ❌ | ✅ | ❌ |
| Canales extra (IG, FB, TG) | ❌ | ✅ 5 canales | ❌ | ❌ |
| Landing revendedores | ❌ | ✅ | ❌ | ❌ |
| **Calidad de IA (español)** | ⚠️ Regular | ✅ | ❌ | ❌ |

**Estrategia:** Migrar a GPT-4o mini para calidad, agregar templates y Meta Provider para competir de frente.

---

## Fases

### Fase 1: Estabilizar y Migrar IA (Semana 1)
**Objetivo:** Bot responde coherente, captura datos, sin bugs visibles.

| # | Tarea | Prioridad |
|---|---|---|
| 1.1 | Arreglar servicios dinámicos por tenant | Crítica |
| 1.2 | Migrar de Groq a GPT-4o mini | Crítica |
| 1.3 | Validar flujo completo: nombre→email→teléfono→agendar | Crítica |
| 1.4 | Limpiar JSON del chat (parser robusto) | Alta |
| 1.5 | Widget usa nombre del tenant, no "NeoWeb Studio" | Alta |

### Fase 2: Templates por Industria (Semana 2)
**Objetivo:** Crear tenant en 1 clic con config pre-armada.

| # | Tarea | Prioridad |
|---|---|---|
| 2.1 | Tabla `industry_templates` + seed data (8 industrias) | Crítica |
| 2.2 | Endpoint API para listar/usar templates | Crítica |
| 2.3 | Wizard: dropdown de industria precarga servicios, prompt, knowledge | Crítica |
| 2.4 | 8 prompts especializados por industria | Alta |

### Fase 3: Landing + Meta Provider (Semana 3-4)
**Objetivo:** Credibilidad comercial y más canales.

| # | Tarea | Prioridad |
|---|---|---|
| 3.1 | Landing page para revendedores (`/partners`) | Crítica |
| 3.2 | ROI calculator interactivo | Alta |
| 3.3 | Demo pre-configurada (widget con tenant demo) | Alta |
| 3.4 | Meta Business Provider verification | Crítica |
| 3.5 | Instagram + Facebook Messenger via Meta API | Alta |
| 3.6 | Telegram Bot adapter | Media |

### Fase 4: Billing + Notificaciones (Semana 5-6)
**Objetivo:** Monetización automatizada para revendedores.

| # | Tarea | Prioridad | Estado |
|---|---|---|---|
| 4.1 | Tabla `subscriptions` + `invoices` | Crítica | ✅ Completado |
| 4.2 | Pasarela de pagos (Wompi — PSE/Nequi/tarjetas) | Crítica | ✅ Completado |
| 4.3 | Auto-suspensión de tenant por falta de pago | Alta | ✅ Completado |
| 4.4 | Email al dueño: nuevo lead, quota al 80%, factura | Alta | ✅ Completado |
| 4.5 | Dashboard financiero para revendedor (MRR, churn) | Media | ✅ API completada, UI pendiente |

### Fase 5: Analytics + Exportación (Semana 7-8)
**Objetivo:** Datos para que el revendedor demuestre ROI a sus clientes.

| # | Tarea | Prioridad |
|---|---|---|
| 5.1 | Gráficos: conversaciones, leads, conversión por tenant | Alta |
| 5.2 | Exportar leads a CSV | Media |
| 5.3 | Dashboard embedible para el cliente final | Media |
| 5.4 | Reporte semanal automático por email | Baja |

---

## Cronograma

```
Semana 1  ████████  Fase 1: Estabilizar + GPT-4o mini
Semana 2  ████████  Fase 2: Templates x industria
Semana 3  ████████  Fase 3: Landing + Meta Provider
Semana 4  ████████  Fase 3: Canales extra (IG, FB, TG)
Semana 5  ████████  Fase 4: Billing + Stripe
Semana 6  ████████  Fase 4: Notificaciones
Semana 7  ████████  Fase 5: Analytics
Semana 8  ████████  Fase 5: Exportación
         ─────────────────────────────────────
         8 semanas → Bot competitivo vs BotPenguin
```

---

## Primera Tarea (AHORA)

**Fase 1.1 + 1.2: Arreglar servicios dinámicos + Migrar a GPT-4o mini**

Esto toma ~30 min y es el mayor impacto inmediato:
1. Debuggear por qué `getTenantServices` no devuelve los servicios del tenant
2. Crear `openai-provider.js` con GPT-4o mini (mejor español, JSON válido, $0.0001/consulta)
3. Probar flujo completo con datos reales
