# Arquitectura OCI — Referencia para Deploys

## Servidores de Aplicaciones

```
synaptiqnova.online ───────> Host Nginx (443) → localhost:8081 → FastAPIPOS lb_prod
bot.synaptiqnova.online ───> Host Nginx (443) → localhost:3099 → Bot-IA-HubSpot
*.wordpress.domains ───────> Host Nginx (443) → localhost:8082 → ClearApp PHP-Apache
sonarqube.synaptiqnova.online → Host Nginx → localhost:9000     → SonarQube
```

## Proyectos y Redes Docker

| Proyecto | Directorio | Red Docker | Containers | RAM |
|---|---|---|---|---|
| Bot-IA-HubSpot | `/home/opc/bot-ia-hubspot` | `bot-ia-hubspot_default` | 3 | ~5.5 GB |
| FastAPIPOS | `/home/opc/FastAPIPOS` | `fastapipos_default` | 18 | ~14 GB |
| ClearApp (WP) | `/home/opc/clearapp` | `fastapipos_default` (external) | 2 | ~1 GB |
| SonarQube | standalone | `fastapipos_default` | 1 | ~2 GB |

## Puertos (127.0.0.1)

| Puerto | Proyecto | Servicio |
|---|---|---|
| 3099 | Bot-IA | Express server |
| 5434 | Bot-IA | PostgreSQL pgvector |
| 8081 | FastAPIPOS | Nginx lb_prod |
| 8082 | ClearApp | PHP-Apache WordPress |
| 3307 | ClearApp | MySQL 8.0 |
| 3000 | FastAPIPOS | Grafana |
| 5433 | FastAPIPOS | PostgreSQL |
| 9091 | FastAPIPOS | Prometheus |
| 9000 | SonarQube | SonarQube |

## WordPress Sites (10)

| Dominio | CMS | Pool PHP-FPM |
|---|---|---|
| carpaspj.com | 22 plugins, 957MB | Dedicado (512MB) |
| micarpa.com | WooCommerce | shared_medium |
| ballaolaorquestadelapaz.com | WooCommerce | shared_medium |
| mariachixochiimilco.online | Elementor | shared_medium |
| mariachixochimilco.com | Elementor | shared_medium |
| editorialjr.online | 10 plugins | shared_medium |
| fundacionlevantateresplandece.online | — | shared_medium |
| chuzolisto.online | Clean | shared_light |
| nuestralechona.online | Clean | shared_light |
| 2ppinmobiliaria.online | Clean | shared_light |

**DB**: MariaDB 10.5 host-level (NO Docker), una DB por sitio
**PHP-FPM**: 4 pools (carpaspj dedicado, shared_medium, shared_light, www)
**Backups**: Semanal a Google Drive (rclone), WP DB + uploads

## Documentación de referencia

| Proyecto | Ruta local |
|---|---|
| WordPress Hosting | `C:\Users\mauro\wordpress-hosting-oci\` |
| FastAPIPOS | `\\wsl.localhost\Ubuntu\home\maurogallo\fastapipos` |
| Bot-IA-HubSpot | `C:\DirectorioTabajo\bot-IA-HubSpot` |

## Reglas de Deploy

### NUNCA
- `docker compose down -v` (destruye volúmenes)
- `docker compose up -d` sin `--no-deps` desde bot/ (arrastra containers de otros proyectos)
- Vincular puertos a `0.0.0.0`
- Levantar Docker Nginx de FastAPIPOS (host Nginx es el único)
- Cambiar puertos 3099, 5434, 8081, 8082

### SIEMPRE para el Bot
```bash
cd /home/opc/bot-ia-hubspot
git pull
docker compose build bot
docker compose up -d --no-deps bot
```

### SIEMPRE para FastAPIPOS
```bash
cd /home/opc/FastAPIPOS
cp .env.prod .env
./scripts/release.sh
```
