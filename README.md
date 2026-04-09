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
| --------------- |----------------| --------------------------------------------------------------------------------------------------------------------------------------- |
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
| Node.js     | >= 20   |
| npm         | >= 10   |

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
| ---------------------- |-------------------------------------------------------------|
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

Die optionale KI-Analyse nutzt die Anthropic API, um Flows automatisch zu bewerten:

- **Konfiguration** über die UI (API-Key + Modellauswahl) — gespeichert als AES-256-GCM-verschlüsselte Datei auf dem Server
- **Unterstützte Modelle:** Claude Sonnet 4, Claude Opus 4, Claude Haiku 4.5
- **Analyse-Ablauf:** Flow-Daten werden an Claude gesendet; Claude kann per Tool-Use PHP-Stub-Sourcecode nachladen und liefert strukturierte Findings (Fehler, Warnungen, Performance, Info) mit Schweregrad zurück
- **Ergebnisse** werden im Flow-Detail als kategorisierte Karten mit betroffenen Stubs angezeigt
