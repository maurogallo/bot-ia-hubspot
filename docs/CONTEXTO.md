# Contexto del Servidor OCI — Bot-IA-HubSpot

> **Documento de referencia para el agente IA. Leer al iniciar cada sesión.**

---

## 1. Acceso al Servidor

| Campo | Valor |
|---|---|
| IP | `132.145.202.10` |
| Usuario | `opc` |
| SSH Key | `C:\DirectorioTabajo\OracleCloudInfraestructure\ssh-key-2026-05-18.key` |
| Comando | `ssh -i "C:\DirectorioTabajo\OracleCloudInfraestructure\ssh-key-2026-05-18.key" -o StrictHostKeyChecking=no opc@132.145.202.10` |
| Sudo | Requiere contraseña (no disponible por pipe, usar `-t`) |
| Forma | `VM.Standard.A1.Flex` (ARM64, 4 OCPU, 24 GB RAM) |
| OS | Oracle Linux 9.7 |

---

## 2. Proyectos en el Servidor

### 2.1 Bot-IA-HubSpot (nuestro proyecto)

| Campo | Valor |
|---|---|
| Directorio | `/home/opc/bot-ia-hubspot` |
| Repo | `https://github.com/maurogallo/bot-ia-hubspot` |
| Rama | `master` |
| Red Docker | `bot-ia-hubspot_default` |
| Containers | `bot` (Node.js), `postgres` (pgvector), `ollama` (LLM) |
| Dominio | `https://bot.synaptiqnova.online` |
| Puerto host | `127.0.0.1:3099→3090` |
| Webhook público | `https://bot.synaptiqnova.online/api/webhook` |
| Dashboard | `https://bot.synaptiqnova.online/dashboard` |

### 2.2 FastAPIPOS (Sistema POS + Synaptiq Nova)

| Campo | Valor |
|---|---|
| Directorio | `/home/opc/FastAPIPOS` |
| Red Docker | `fastapipos_default` |
| Containers | 18 (fastapi x3, frontend, db, redis cluster x6, pgbouncer, rabbitmq, grafana, prometheus, exporters...) |
| Dominio | `https://synaptiqnova.online` |
| Puerto host | `127.0.0.1:8081→80` |
| ⚠️ **NO TOCAR** | Este proyecto tiene su propio CI/CD. Nunca modificar sus containers ni su compose. |

### 2.3 ClearApp (WordPress Hosting)

| Campo | Valor |
|---|---|
| Directorio | `/home/opc/clearapp` |
| Red Docker | `fastapipos_default` (external) |
| Containers | `php` (PHP-Apache), `mysql` (MySQL 8.0) |
| Puertos host | `127.0.0.1:8082→80`, `127.0.0.1:3307→3306` |
| 10 sitios WordPress | carpaspj.com, micarpa.com, ballaolaorquestadelapaz.com, mariachixochiimilco.online, mariachixochimilco.com, editorialjr.online, fundacionlevantateresplandece.online, chuzolisto.online, nuestralechona.online, 2ppinmobiliaria.online |
| ⚠️ **WP DB** | MariaDB 10.5 en el HOST (no Docker). 1 base por sitio. PHP-FPM con 4 pools. |

### 2.4 SonarQube (Standalone)

| Campo | Valor |
|---|---|
| Container | `sonarqube` |
| Red | `fastapipos_default` |
| Puerto host | `127.0.0.1:9000` |
| Dominio | `https://sonarqube.synaptiqnova.online` |

---

## 3. Arquitectura de Tráfico

```
Usuario → Cloudflare → Host Nginx (443, SSL)
  ├─ synaptiqnova.online        → 127.0.0.1:8081 (FastAPIPOS lb_prod)
  ├─ bot.synaptiqnova.online    → 127.0.0.1:3099 (Bot Express)
  ├─ *.wordpress.domains        → 127.0.0.1:8082 (ClearApp PHP)
  └─ sonarqube.synaptiqnova.online → 127.0.0.1:9000 (SonarQube)
```

**Host Nginx** es el ÚNICO que escucha en 0.0.0.0:80/443. Todo lo demás en 127.0.0.1.

---

## 4. Widget de Chat (Instalado en synaptiqnova.online)

```html
<script src="https://bot.synaptiqnova.online/widget.js"
  data-api-url="https://bot.synaptiqnova.online/api/webhook"
  data-tenant="synaptiq"
  data-primary="#9333ea">
</script>
```

Instalado en: `/home/opc/FastAPIPOS/landing/index.html` y `landing/pos/index.html`

**Tenant synaptiq**: plan Business, servicios (Fabric, Databricks, BI, Analytics), cache tenant-aware.

---

## 5. Tenant Default

| Campo | Valor |
|---|---|
| Slug | `default` |
| Nombre | NeoWeb Studio |
| Plan | business |
| Servicios | Landing Pages (299), Desarrollo Web (799), Automatización (499) — defaults |

---

## 6. Reglas de Deploy del Bot

### NUNCA
- `docker compose up -d` a secas desde `/home/opc/bot-ia-hubspot` (recrea todo y rompe otras redes)
- `docker compose down` (tira servicios de otros proyectos si comparten red)
- Vincular puertos a `0.0.0.0`
- Cambiar puertos 3099 o 5434 (host nginx tiene hardcodeados)
- `docker compose up -d` desde FastAPIPOS (rompe la red compartida)

### Procedimiento seguro

```bash
# Conectar al servidor
ssh -i "C:\DirectorioTabajo\OracleCloudInfraestructure\ssh-key-2026-05-18.key" opc@132.145.202.10

# Si hay que buildear (cambios en package.json/Dockerfile) — parar FastAPI antes
docker stop fastapipos-fastapi-1 fastapipos-fastapi-2 fastapipos-fastapi-3
cd /home/opc/bot-ia-hubspot
git pull
docker compose build bot
docker compose up -d --no-deps bot
docker start fastapipos-fastapi-1 fastapipos-fastapi-2 fastapipos-fastapi-3

# Si es solo cambio de código (sin dependencias nuevas):
cd /home/opc/bot-ia-hubspot
git pull
docker compose build bot        # el build es rápido (COPY . .)
docker compose up -d --no-deps bot

# Verificar
docker compose logs --tail 5 bot
curl -sk https://bot.synaptiqnova.online/health
```

---

## 7. Troubleshooting

### El bot no responde (timeout)
- **Causa**: Ollama sobrecargado. CPU ARM saturada.
- **Fix**: Esperar o cambiar modelo a qwen2:1.5b. Ver logs: `docker compose logs bot | grep -i ollama`

### 502 Bad Gateway en synaptiqnova.online
- **Causa**: `fastapipos_lb_prod` caído o reiniciando.
- **Fix**: `docker restart fastapipos_lb_prod`

### WordPress no carga
- **Causa**: Permisos de `/etc/letsencrypt/live/` rotos.
- **Fix**: `docker run --rm -v /etc/letsencrypt:/letsencrypt alpine sh -c 'chmod 755 /letsencrypt/live /letsencrypt/archive && chmod -R 755 /letsencrypt/live/* /letsencrypt/archive/*'`

### Dashboard roto (código JS visible)
- **Causa**: `</script>` dentro de un string JS en el HTML.
- **Fix**: Escaparlo como `<\/script>`.

### Rate limit (429)
- **Causa**: Dashboard hace muchas requests (5 pestañas x 5s = 84 req/min). Límite era 30.
- **Fix**: Subido a 200 en `src/config.js`.

### Container del bot no arranca (MODULE_NOT_FOUND)
- **Causa**: `googleapis` no instalado en la imagen.
- **Fix**: `docker compose build bot --no-cache` (requiere parar FastAPI antes).

### FastAPI se cae (OOM kill)
- **Causa**: Build del bot consumió RAM, OOM killer mató FastAPI.
- **Fix**: Parar FastAPI antes de buildear el bot, iniciar después.

---

## 8. Documentos de Referencia

| Documento | Ruta |
|---|---|
| AGENTS.md del bot | `C:\DirectorioTabajo\bot-IA-HubSpot\AGENTS.md` |
| Arquitectura OCI (este doc) | `C:\DirectorioTabajo\bot-IA-HubSpot\docs\arquitectura-oci.md` |
| Plan multi-tenant | `C:\DirectorioTabajo\bot-IA-HubSpot\docs\plan-multi-tenant.md` |
| Plan agendamiento | `C:\DirectorioTabajo\bot-IA-HubSpot\docs\plan-agendamiento.md` |
| Plan de trabajo | `C:\DirectorioTabajo\bot-IA-HubSpot\docs\plan-de-trabajo.md` |
| Guía instalación widget | `C:\DirectorioTabajo\bot-IA-HubSpot\docs\guia-instalacion-widget.md` |
| WordPress Hosting docs | `C:\Users\mauro\wordpress-hosting-oci\` |
| FastAPIPOS docs | `\\wsl.localhost\Ubuntu\home\maurogallo\fastapipos\` |
