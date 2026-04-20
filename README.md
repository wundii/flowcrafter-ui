# FlowCrafter UI

Web-Frontend für [FlowCrafter](https://github.com/wundii/flowcrafter) — visualisiert Flow-Instanzen, Messages, Exceptions und Queue-Status aus dem PHP-Backend in Echtzeit.

<p align="center">
  <picture>
    <img src="https://raw.githubusercontent.com/wundii/flowcrafter-ui/refs/heads/main/assets/screen_01.png" alt="wundii/flowcrafter" style="width: 100%; max-width: 600px; height: auto;">
  </picture>
</p>
<p align="center">
  <picture>
    <img src="https://raw.githubusercontent.com/wundii/flowcrafter-ui/refs/heads/main/assets/screen_02.png" alt="wundii/flowcrafter" style="width: 100%; max-width: 600px; height: auto;">
  </picture>
</p>
<p align="center">
  <picture>
    <img src="https://raw.githubusercontent.com/wundii/flowcrafter-ui/refs/heads/main/assets/screen_03.png" alt="wundii/flowcrafter" style="width: 100%; max-width: 600px; height: auto;">
  </picture>
</p>

## Stack

- [Lit v3](https://lit.dev/) — Web Components
- [Vite v6](https://vitejs.dev/) — Build-Tool / Dev-Server
- [Tailwind CSS v4](https://tailwindcss.com/) — Utility-CSS
- [DaisyUI v5](https://daisyui.com/) — Komponenten-Bibliothek
- [CodeMirror 6](https://codemirror.net/) — JSON-Editor & PHP-Source-Viewer mit Syntax-Highlighting
- [Anthropic SDK](https://docs.anthropic.com/en/api) — KI-gestützte Flow-Analyse (optional)

---

## Architektur

Das UI kommuniziert mit **zwei Backends**:

| Backend         | Port           | Zweck                                                                                                                                   |
| --------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Node.js-Server  | `3000`         | Auth, Verbindungskonfiguration, KI-Analyse — im Dev via Vite-Proxy auf `/api/auth`, `/api/connection`, `/api/ai-config`, `/api/analyze` |
| FlowCrafter-API | konfigurierbar | Flow-Daten, Exceptions, Queues, Schemas, Stub-Sourcen — URL wird im Node-Backend gespeichert                                            |

**Auth-Flow:**

1. Beim ersten Start: Passwort über `fc-login` festlegen (`/api/auth/setup`)
2. Bei jedem weiteren Start: Login → JWT-Token im `sessionStorage`
3. Token wird als `Authorization: Bearer <token>` an alle Requests angehängt
4. Nach dem Login: FlowCrafter-Service-URL über `fc-service-setup` konfigurieren

---

## Voraussetzungen

| Anforderung | Version |
| ----------- | ------- |
| Node.js     | >= 24   |
| npm         | >= 11   |

---

## Inbetriebnahme

### 1. Abhängigkeiten installieren

```bash
npm install
```

### 2. Dev-Server starten

```bash
npm run dev
```

Frontend erreichbar unter: **http://localhost:5173**

### Alternative: Docker

Das fertige Docker-Image [`wundii/flowcrafter-ui`](https://hub.docker.com/r/wundii/flowcrafter-ui) kann direkt verwendet werden:

```bash
docker run -p 5173:5173 -v ./data:/flowcrafter/data wundii/flowcrafter-ui:latest
```

Die UI ist dann unter **http://localhost:5173** erreichbar. Das Volume `/flowcrafter/data` enthält Auth-, Verbindungs- und KI-Konfigurationsdaten.

Zum manuellen Bauen:

```bash
docker build -t flowcrafter-ui .
```

---

## Verfügbare Scripts

| Befehl                 | Beschreibung                                                |
| ---------------------- | ----------------------------------------------------------- |
| `npm run dev`          | Dev-Server mit Hot-Reload starten (Vite :5173 + Node :3000) |
| `npm run build`        | Produktions-Build nach `dist/`                              |
| `npm run start`        | Produktions-Server (Node serviert `dist/`)                  |
| `npm run lint`         | ESLint prüfen                                               |
| `npm run lint:fix`     | ESLint automatisch korrigieren                              |
| `npm run format`       | Prettier formatieren                                        |
| `npm run format:check` | Prettier prüfen                                             |

---

## API-Endpunkte

### Node.js-Server (Auth, Verbindung & KI)

| Methode | Pfad                        | Beschreibung                          |
| ------- | --------------------------- | ------------------------------------- |
| GET     | `/api/auth/status`          | Auth-Status + ob Passwort gesetzt ist |
| POST    | `/api/auth/setup`           | Erstes Passwort festlegen             |
| POST    | `/api/auth/login`           | Anmelden → Session-Token              |
| POST    | `/api/auth/logout`          | Abmelden                              |
| POST    | `/api/auth/change-password` | Passwort ändern                       |
| GET     | `/api/connection`           | Gespeicherte Service-URL abrufen      |
| POST    | `/api/connection`           | Service-URL & Secret speichern        |
| DELETE  | `/api/connection`           | Verbindung zurücksetzen               |
| GET     | `/api/version`              | UI-Version (Image-Tag) abrufen        |
| GET     | `/api/ai-config`            | KI-Konfiguration abrufen              |
| POST    | `/api/ai-config`            | API-Key & Modell speichern            |
| DELETE  | `/api/ai-config`            | KI-Konfiguration löschen              |
| POST    | `/api/analyze`              | Flow-Analyse starten (NDJSON-Stream)  |
| POST    | `/api/fc-ping`              | FlowCrafter-Erreichbarkeit testen     |
| ALL     | `/api/fc/*`                 | Proxy zu FlowCrafter-API (mit Auth)   |
| GET     | `/metrics`                  | Prometheus-Metriken (siehe unten)     |

---

## Monitoring

Der Node.js-Server stellt unter `GET /metrics` einen Prometheus-kompatiblen Endpoint bereit (kein Auth erforderlich):

| Metrik                                          | Typ     | Beschreibung                                     |
| ----------------------------------------------- | ------- | ------------------------------------------------ |
| `flowcrafter_ui_uptime_seconds`                 | Gauge   | Uptime des Node-Servers in Sekunden              |
| `flowcrafter_ui_http_requests_total`            | Counter | HTTP-Requests nach `method`, `path` und `status` |
| `flowcrafter_ui_http_request_duration_ms_total` | Counter | Gesamt-Dauer aller Requests in ms nach Route     |
| `flowcrafter_ui_http_request_duration_ms_count` | Counter | Anzahl Requests pro Route                        |

Pfade werden normalisiert (`/api/auth/*`, `/api/fc/*`, `/static`), um die Label-Kardinalität niedrig zu halten.

---

## KI-Analyse

Die optionale KI-Analyse bewertet Flows automatisch und liefert kategorisierte Findings (Fehler, Warnungen, Performance, Info). Zwei Anbieter stehen zur Wahl:

| Anbieter         | Kosten     | Datenschutz            | Einrichtung          |
| ---------------- | ---------- | ---------------------- | -------------------- |
| Anthropic Claude | API-Kosten | Daten verlassen Server | API-Key erforderlich |
| Ollama (lokal)   | kostenlos  | Daten bleiben lokal    | Docker-Container     |

### Anthropic Claude

1. API-Key unter [console.anthropic.com](https://console.anthropic.com) erstellen
2. In der UI: **AI-Einstellungen → Anthropic Claude → API-Key eingeben → Speichern**
3. Unterstützte Modelle: Claude Sonnet 4, Claude Opus 4, Claude Haiku 4.5

### Ollama (lokal, empfohlen für Docker-Setups)

Ollama ermöglicht lokale KI-Analyse ohne API-Kosten. Der einfachste Weg ist ein Docker-Container im selben Netzwerk wie das FlowCrafter UI.

#### 1. Ollama-Container starten

In der `docker-compose.yml` des Projekts, das auch den FlowCrafter-UI-Container enthält:

```yaml
services:
  ollama:
    image: ollama/ollama:latest # AMD GPU (ROCm): ollama/ollama:rocm
    container_name: 'ollama'
    restart: unless-stopped
    ports:
      - '11434:11434'
    volumes:
      - ollama_data:/root/.ollama

volumes:
  ollama_data:
```

Für **AMD-GPUs** (ROCm) stattdessen `ollama/ollama:rocm` verwenden und GPU-Geräte einbinden:

```yaml
image: ollama/ollama:rocm
devices:
  - /dev/kfd
  - /dev/dri
group_add:
  - video
  - render
```

Container starten:

```bash
docker compose up -d ollama
```

#### 2. Modell laden

```bash
# Empfohlen: gutes Verhältnis Qualität/Größe (~9 GB)
docker exec ollama ollama pull qwen2.5-coder:14b

# Kleiner: für Systeme mit wenig RAM (~5 GB)
docker exec ollama ollama pull qwen2.5-coder:7b

# Minimal: sehr schnell, einfache Analysen (~1 GB)
docker exec ollama ollama pull qwen2.5-coder:1.5b
```

Der Download kann je nach Internetgeschwindigkeit einige Minuten dauern. Modelle werden im Volume `ollama_data` dauerhaft gespeichert.

#### 3. In der UI konfigurieren

In der UI: **AI-Einstellungen → Ollama (lokal) → URL eingeben → Speichern**

| Szenario                               | URL                                   |
| -------------------------------------- | ------------------------------------- |
| Ollama im selben Docker-Netzwerk       | `http://ollama:11434`                 |
| Ollama nativ auf dem Host (Linux)      | `http://host.docker.internal:11434` ¹ |
| Ollama nativ, direkter Netzwerkzugriff | `http://<host-ip>:11434`              |

¹ Setzt `extra_hosts: ["host.docker.internal:host-gateway"]` im FlowCrafter-UI-Container voraus, und Ollama muss auf `0.0.0.0` binden (`OLLAMA_HOST=0.0.0.0:11434`).

#### Analyse-Ablauf

1. Flow-Daten und (optional) ein spezifischer Run werden an das Modell gesendet
2. Das Modell kann per Tool-Use PHP-Stub-Sourcecode aus dem FlowCrafter-Backend nachladen
3. Ergebnis: strukturierte Findings mit Kategorie, Schweregrad und betroffenem Stub
4. Token-Verbrauch wird im Ergebnis-Modal angezeigt (Input · Output · Gesamt)
