# Guía de Instalación — Widget de Chat IA

## Requisitos

- Tener un sitio web (landing page, WordPress, HTML, etc.)
- Tener creado tu tenant en el panel de administración

---

## Instalación

Copiá y pegá este código **antes del `</body>`** en todas las páginas donde quieras que aparezca el chat:

```html
<script src="https://bot.synaptiqnova.online/widget.js"
  data-tenant="TU-SLUG"
  data-primary="#TU-COLOR">
</script>
```

### Atributos

| Atributo | ¿Requerido? | Descripción | Ejemplo |
|---|---|---|---|
| `data-tenant` | **Sí** | Slug de tu negocio asignado por el administrador | `"clinica-san-jose"` |
| `data-primary` | No | Color del botón y globos de chat (hex) | `"#059669"` (verde) |
| `data-welcome` | No | Mensaje inicial del bot | `"¡Hola! Soy tu asistente virtual."` |

### Ejemplo completo

```html
<script src="https://bot.synaptiqnova.online/widget.js"
  data-tenant="clinica-san-jose"
  data-primary="#059669"
  data-welcome="¡Hola! Soy el asistente virtual de Clínica San José. ¿En qué puedo ayudarte?">
</script>
```

---

## Dónde pegarlo

### WordPress
1. Andá a **Apariencia > Editor de temas**
2. Abrí `footer.php` o `header.php`
3. Pegá el `<script>` antes de `</body>` o dentro de `<head>`
4. Guardá cambios

### HTML estático
Pegá el `<script>` antes de `</body>` en tu `index.html`.

### Shopify / Wix / Squarespace
Buscá la opción "Insertar código HTML" o "Custom code" en el footer del sitio.

---

## ¿Qué hace el widget?

- Aparece un **botón flotante** abajo a la derecha del sitio
- Al hacer click se abre una **ventana de chat**
- El bot responde automáticamente con IA
- Si tu plan lo incluye, **agenda reuniones** y registra leads en tu CRM

---

## ¿No funciona?

1. Verificá que el slug esté bien escrito (`data-tenant` exacto)
2. Revisá que el `<script>` esté en todas las páginas donde querés el chat
3. Limpiá caché del navegador (Ctrl+F5)
4. Contactá a tu administrador si el problema persiste
