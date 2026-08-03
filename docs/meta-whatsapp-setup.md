# Configuración Meta Business API (WhatsApp)

## Credenciales

| Campo | Valor |
|---|---|
| App Name | Synaptiq Nova |
| App ID | `2352206648917615` |
| Phone Number ID | `1231833500016705` |
| WhatsApp Business Account ID | `1342251534637602` |
| Test Phone Number | `+1 (555) 673-6492` |
| Verify Token | `bot-verify-token` |
| Access Token (expira 24h) | Ver sección "Regenerar Token" |
| Webhook URL | `https://bot.synaptiqnova.online/api/meta-webhook` |
| Meta Account | `maurogallo@gmail.com` |
| Business Portfolio | Synaptiq Nova |

## Regenerar Token (cuando expira)

Los tokens de prueba de Meta expiran cada ~12-24 horas. Para regenerar:

1. Entrar a https://developers.facebook.com/
2. **My Apps** → **Synaptiq Nova**
3. Menú lateral → **WhatsApp** → **API Setup** (o Configuración)
4. En la sección "Paso 1. Probar", buscar **"Identificador de acceso"**
5. Click en **"Generar token"** (o el botón para regenerar)
6. Copiar el nuevo token (empieza con `EAA...`)
7. Actualizar en el servidor:

```bash
cd /home/opc/bot-ia-hubspot
sed -i 's|META_ACCESS_TOKEN=.*|META_ACCESS_TOKEN=NUEVO_TOKEN|' .env
docker compose up -d --force-recreate bot
sleep 5
curl -s "https://bot.synaptiqnova.online/api/meta-webhook?hub.mode=subscribe&hub.verify_token=bot-verify-token&hub.challenge=test"
curl -s -X POST "https://graph.facebook.com/v21.0/1342251534637602/subscribed_apps" -H "Authorization: Bearer NUEVO_TOKEN"
```

## Destinatarios de Prueba

El número de prueba de Meta solo puede enviar/recibir mensajes de hasta **5 números verificados**. Para agregar un destinatario:

1. Meta Dashboard → WhatsApp → API Setup
2. En "Envía un mensaje desde tu número de prueba"
3. Campo **"Destinatario"** → seleccionar o agregar número
4. El número debe estar en formato internacional: `+573026415567`

**Números actuales autorizados:**
- `+57 302 641 5567` (Mauricio)

## Configuración en el Servidor

### Variables en `.env`
```
WHATSAPP_DRIVER=meta
META_PHONE_NUMBER_ID=1231833500016705
META_ACCESS_TOKEN=EAAhbUcmZCPm8BS...
META_VERIFY_TOKEN=bot-verify-token
```

### Variables en `docker-compose.override.yml`
```yaml
environment:
  META_PHONE_NUMBER_ID: ${META_PHONE_NUMBER_ID:-}
  META_ACCESS_TOKEN: ${META_ACCESS_TOKEN:-}
  META_VERIFY_TOKEN: ${META_VERIFY_TOKEN:-}
  WHATSAPP_DRIVER: ${WHATSAPP_DRIVER:-webjs}
```

## Verificar Webhook

```bash
curl -s "https://bot.synaptiqnova.online/api/meta-webhook?hub.mode=subscribe&hub.verify_token=bot-verify-token&hub.challenge=test123"
# Debe retornar: test123
```

## Suscribir App al WABA

```bash
curl -s -X POST "https://graph.facebook.com/v21.0/1342251534637602/subscribed_apps" \
  -H "Authorization: Bearer $META_ACCESS_TOKEN"
# Debe retornar: {"success":true}
```

## Enviar Mensaje de Prueba (API Directa)

```bash
curl -s -X POST "https://graph.facebook.com/v21.0/1231833500016705/messages" \
  -H "Authorization: Bearer $META_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"messaging_product":"whatsapp","to":"573026415567","type":"text","text":{"body":"Mensaje de prueba"}}'
```

## Troubleshooting

### "El número ya está registrado con una cuenta de WhatsApp"
El número personal ya existe en WhatsApp normal. Opciones:
- Usar otra SIM
- Comprar número virtual (Twilio ~$1/mes)
- Usar modo QR (WHATSAPP_DRIVER=webjs)

### "Session has expired"
El token de acceso expiró. Regenerar siguiendo los pasos de arriba.

### Webhook no recibe mensajes
1. Verificar webhook: `curl ... hub.mode=subscribe...`
2. Resuscribir app: `POST .../subscribed_apps`
3. Verificar que el número está en destinatarios de prueba

### Bot responde pero el mensaje no llega a WhatsApp
- Verificar que el token no expiró
- Verificar que `config.whatsapp.meta.accessToken` tiene el valor correcto
- Verificar logs: `docker compose logs bot | grep "Meta send"`

### Puerto 3099 vs 3090
El bot internamente escucha en 3090, pero docker-compose mapea `127.0.0.1:3099→3090`. El host nginx proxy a `127.0.0.1:3099`. Si el puerto cambia, actualizar ambos.

## Para Producción (pendiente)

Para usar WhatsApp sin restricciones (más de 5 destinatarios, número real):
1. Completar verificación de empresa en Meta (2-10 días)
   - Subir documentos: certificado de constitución, licencia comercial
2. Agregar método de pago en Meta Dashboard
3. Publicar la aplicación
4. Migrar de número de prueba a número de producción
