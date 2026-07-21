# Bot Comercial con IA para HubSpot

Este proyecto es una prueba de concepto para un bot comercial impulsado por IA que se integra con el CRM de HubSpot, tal como se discutió en la fase de planificación inicial.

Presenta un servidor web simple que simula un backend de chatbot, un agente de IA para el análisis básico de mensajes y la integración con HubSpot para la creación de leads.

## Características

-   **Servidor Web Express**: Un servidor Node.js para manejar solicitudes de webhook.
-   **Agente de IA Simulado**: Analiza mensajes para detectar la intención de venta y extraer datos del usuario (nombre, correo electrónico).
-   **Integración con HubSpot**: Crea automáticamente un nuevo contacto en HubSpot cuando se identifica un lead.
-   **Configuración Segura**: Utiliza un archivo `.env` para gestionar de forma segura la clave API de HubSpot.

---

## Prerrequisitos

-   [Node.js](https://nodejs.org/) (v14 o superior)
-   Una cuenta de [HubSpot](https://www.hubspot.com/) (el CRM gratuito es suficiente)
-   Un Token de Aplicación Privada de HubSpot

### Cómo obtener un Token de Aplicación Privada de HubSpot

1.  Ve a la configuración de tu cuenta de HubSpot: `Configuración` > `Integraciones` > `Aplicaciones Privadas`.
2.  Crea una nueva aplicación privada.
3.  Asigna un nombre a tu aplicación (ej., "Bot Comercial IA").
4.  Ve a la pestaña "Scopes" (Ámbitos) de tu aplicación.
5.  Busca `crm.objects.contacts.write` y `crm.objects.contacts.read` y marca las casillas.
6.  Haz clic en "Crear aplicación" y copia el token de acceso generado. Esta será tu `HUBSPOT_API_KEY`.

---

## Configuración

1.  **Clona el repositorio o descarga los archivos.**

2.  **Instala las dependencias:**
    Abre tu terminal en la raíz del proyecto y ejecuta:
    ```bash
    npm install
    ```

3.  **Configura tu Clave API de HubSpot:**
    -   Encontrarás un archivo llamado `.env` en la raíz del proyecto.
    -   Ábrelo y reemplaza `"your_private_app_token_here"` con el token real de HubSpot que generaste.
    ```
    # .env
    HUBSPOT_API_KEY="pega-tu-token-real-aquí"
    ```

---

## Cómo Ejecutar el Servidor del Bot

1.  **Inicia el servidor:**
    ```bash
    npm start
    ```
    Deberías ver un mensaje de confirmación en tu terminal:
    ```
    Bot server is running on http://localhost:3000
    Waiting for messages on the /webhook endpoint...
    ```

2.  **Prueba el webhook:**
    Puedes usar una herramienta como `curl` o Postman para simular el envío de un mensaje a tu bot.

    **Ejemplo 1: Una pregunta general**
    ```bash
    curl -X POST -H "Content-Type: application/json" -d "{"message": "Hola, qué servicios ofrecen?", "from": "+123456789"}" http://localhost:3000/webhook
    ```
    *Respuesta Esperada:* Un mensaje de bienvenida genérico.

    **Ejemplo 2: Un lead que necesita un servicio pero no proporciona un correo electrónico**
    ```bash
    curl -X POST -H "Content-Type: application/json" -d "{"message": "Necesito una landing page para mi negocio", "from": "+123456789"}" http://localhost:3000/webhook
    ```
    *Respuesta Esperada:* Un mensaje solicitando su dirección de correo electrónico.

    **Ejemplo 3: Un lead que proporciona toda la información**
    ```bash
    curl -X POST -H "Content-Type: application/json" -d "{"message": "Hola, me llamo Juan y necesito un sitio web. Mi correo es juan.perez@example.com", "from": "+987654321"}" http://localhost:3000/webhook
    ```
    *Resultado Esperado:*
    -   El servidor responderá con un mensaje de agradecimiento.
    -   Se creará un nuevo contacto, "Juan", con el correo electrónico "juan.perez@example.com" en tu CRM de HubSpot. Verifica tus contactos de HubSpot.

---

## Próximos Pasos y Mejoras

-   **Reemplazar la IA Simulada**: La función `analyzeMessageWithAI` en `index.js` puede ser reemplazada por llamadas a un servicio de IA real como GPT de OpenAI, Gemini de Google, o un modelo auto-hospedado usando Hermes.
-   **Integración con WhatsApp/Web**: Conecta este servidor a una interfaz de chatbot real, como Twilio para WhatsApp o un widget de chat en tu sitio web. El endpoint `/webhook` está listo para ser utilizado con este propósito.
-   **Expandir la Funcionalidad de HubSpot**: Añade capacidades para crear negocios, actualizar contactos o buscar clientes existentes para evitar duplicados.
-   **Manejo de Errores**: Mejora el manejo de errores para un uso más robusto en producción.
