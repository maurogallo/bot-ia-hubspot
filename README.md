# Bot IA HubSpot

Bot comercial multicanal impulsado por IA que captura, califica y registra leads en HubSpot CRM. Atiende clientes desde WhatsApp y web, con agente IA local vía Ollama.

## Stack

- **Backend**: Node.js + Express
- **Base de datos**: PostgreSQL 16
- **LLM local**: Ollama (Llama 3 / Mistral)
- **CRM**: HubSpot (OAuth2 + refresh tokens)
- **WhatsApp**: whatsapp-web.js (sesión persistente)
- **Infraestructura**: Docker Compose

## Cómo empezar

### Desarrollo local
Requiere PostgreSQL y Ollama corriendo:
```bash
npm install
npm start
```

### Producción (Docker)
```bash
docker compose up -d
# Escanear QR de WhatsApp
curl http://localhost:3000/whatsapp/qr
# Autenticar HubSpot
curl http://localhost:3000/auth/hubspot
```

## Documentación

Ver [`AGENTS.md`](AGENTS.md) para documentación técnica completa del desarrollo.
