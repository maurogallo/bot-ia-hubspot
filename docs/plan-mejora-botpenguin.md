# Plan de Mejora — Basado en BotPenguin

## Fase 1: Estabilizar (Ya casi listo)

### 1.1 Arreglar bugs críticos
- [ ] Servicios dinámicos del tenant cargan correctamente en el prompt
- [ ] Flujo nombre → email → teléfono → agendar 100% funcional
- [ ] JSON del LLM no se muestra en el chat
- [ ] Widget muestra nombre del tenant, no "NeoWeb Studio"

### 1.2 Velocidad y confiabilidad
- [ ] Groq como primary, Ollama como fallback automático ✅ (ya funciona)
- [ ] Rate limit handling con retry automático

---

## Fase 2: Templates por Industria

Crear configuraciones pre-armadas para crear tenants en 1 clic.

### 2.1 Tabla `industry_templates`
```sql
CREATE TABLE industry_templates (
  id UUID, name TEXT, icon TEXT,
  default_services JSONB,     -- servicios predefinidos
  default_prompt TEXT,         -- prompt especializado
  default_knowledge JSONB,     -- knowledge base seed
  qualification_questions JSONB -- preguntas de calificación
);
```

### 2.2 Templates iniciales (8 industrias)

| Industria | Servicios ejemplo | Prompt especializado |
|---|---|---|
| Salud (Clínicas) | Consulta general, Especialidad, Urgencia | "Pregunta síntomas, urgencia, obra social" |
| Legal (Abogados) | Consulta jurídica, Juicio, Mediación | "Pregunta tipo de caso, urgencia, documentación" |
| Inmobiliaria | Compra, Venta, Alquiler, Tasación | "Pregunta tipo de propiedad, zona, presupuesto" |
| Educación | Curso online, Presencial, Corporativo | "Pregunta nivel, objetivo, disponibilidad horaria" |
| Estética/Salones | Corte, Color, Tratamiento, Uñas | "Pregunta servicio, preferencia de horario, profesional" |
| Restaurantes | Reserva, Delivery, Evento privado | "Pregunta cantidad de personas, fecha, ocasión" |
| Tecnología | Desarrollo, Consultoría, Soporte | "Pregunta stack tecnológico, equipo, deadline" |
| Finanzas | Asesoría, Inversión, Contabilidad | "Pregunta tipo de empresa, facturación, necesidades" |

### 2.3 Wizard con selector de template
En el paso 1 del wizard existente, agregar dropdown: "Seleccioná la industria del cliente" que precarga servicios, prompt e instrucciones.

---

## Fase 3: Más Canales

### 3.1 Instagram DM
- [ ] Integrar Instagram Graph API (requiere Facebook Business)
- [ ] Mismo adapter pattern que Meta WhatsApp

### 3.2 Facebook Messenger
- [ ] Integrar Messenger API (misma infraestructura que Meta WhatsApp)
- [ ] Reutilizar `meta-whatsapp-adapter.js` con adaptaciones mínimas

### 3.3 Telegram
- [ ] Bot de Telegram (API gratuita, sin aprobación)
- [ ] Nuevo adapter `telegram-adapter.js`

---

## Fase 4: Herramientas de Venta

### 4.1 Landing page para revendedores
- Página en `bot.synaptiqnova.online/partners`
- Planes y precios para revendedores
- Calculadora de ganancias
- Formulario de contacto

### 4.2 ROI Calculator
```
Si un cliente recibe X consultas/mes
y el bot atiende el Y%
→ Ahorro de Z horas/mes
→ ROI de $XXX/mes
```

### 4.3 Demo interactiva
- Widget pre-configurado con tenant de demo
- Diferentes escenarios: clínica, inmobiliaria, abogado
- El revendedor puede compartir el link de demo

---

## Fase 5: Integraciones Avanzadas

### 5.1 Zapier / Webhooks
- [ ] Endpoint de webhook saliente: cuando se crea un lead, disparar a Zapier
- [ ] Esto automáticamente da acceso a 5000+ apps

### 5.2 Email Marketing
- [ ] Integración con Mailchimp/ConvertKit
- [ ] Auto-agregar leads capturados a listas de email

### 5.3 Notificaciones
- [ ] Email al dueño del tenant cuando hay un lead nuevo
- [ ] Email al revendedor cuando un tenant llega al 80% de quota
- [ ] Resumen diario/semanal de actividad

---

## Fase 6: UX del Dashboard

### 6.1 Vista previa del widget
- [ ] En la página de edición del tenant, mostrar cómo se ve el widget
- [ ] Preview en vivo con los colores y nombre del cliente

### 6.2 Analytics por tenant
- [ ] Gráficos de conversación (cuántos leads, conversiones)
- [ ] Tasa de captura de datos (nombre vs email vs teléfono)
- [ ] Tiempo promedio de respuesta

### 6.3 Exportación
- [ ] Exportar leads a CSV
- [ ] Exportar conversaciones a PDF

---

## Prioridad

| Fase | Semanas | Impacto |
|---|---|---|
| 1. Estabilizar | 0 (casi listo) | Crítico |
| 2. Templates | 1 | Alto |
| 3. Canales | 2-3 | Alto |
| 4. Venta | 1 | Alto |
| 5. Integraciones | 2 | Medio |
| 6. UX | 2 | Medio |

**Total: 8-10 semanas para versión completa.**
