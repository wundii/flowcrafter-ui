# FlowCrafter UI

Web-Frontend für [FlowCrafter](https://github.com/wundii/flowcrafter) — visualisiert Flow-Instanzen, Messages, Exceptions und Queue-Status aus dem PHP-Backend in Echtzeit.

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

Frontend erreichbar unter: **http://localhost:8001**

### Alternative: Docker

Das fertige Docker-Image [`wundii/flowcrafter-ui`](https://hub.docker.com/r/wundii/flowcrafter-ui) kann direkt verwendet werden:

```bash
docker run -p 3000:3000 -v ./data:/flowcrafter/data wundii/flowcrafter-ui:latest
```

Die UI ist dann unter **http://localhost:3000** erreichbar. Das Volume `/flowcrafter/data` enthält Auth-, Verbindungs- und KI-Konfigurationsdaten.

Zum manuellen Bauen:

```bash
docker build -t flowcrafter-ui .
```

---

## Verfügbare Scripts

| Befehl                 | Beschreibung                                                |
| ---------------------- | ----------------------------------------------------------- |
| `npm run dev`          | Dev-Server mit Hot-Reload starten (Vite :8001 + Node :3000) |
| `npm run build`        | Produktions-Build nach `dist/`                              |
| `npm run start`        | Produktions-Server (Node serviert `dist/`)                  |
| `npm run lint`         | ESLint prüfen                                               |
| `npm run lint:fix`     | ESLint automatisch korrigieren                              |
| `npm run format`       | Prettier formatieren                                        |
| `npm run format:check` | Prettier prüfen                                             |

---

## Projektstruktur

```
flowcrafter-ui/
├── src/
│   ├── components/
│   │   ├── fc-app.js            # Root-Komponente: Navigation, Tabs, Routing, Toolbar, AI-Config
│   │   ├── fc-login.js          # Login / Ersteinrichtung (Passwort)
│   │   ├── fc-service-setup.js  # FlowCrafter-Service-URL konfigurieren
│   │   ├── fc-overview.js       # Schema/Stub-Browser: alle Schemas mit Stubs, Source-Viewer, Graph
│   │   ├── fc-type-list.js      # Übersichtskacheln pro Flow-Typ (Anzahl, Erfolgsrate)
│   │   ├── fc-flow-list.js      # Paginierte Tabelle aller Flow-Instanzen mit Datumsfilter
│   │   ├── fc-flow-detail.js    # Detail-Ansicht: Runs, Messages, Exceptions, AI-Analyse, Raw-JSON
│   │   ├── fc-flow-chart.js     # SVG-Liniendiagramm: Flows pro Tag (14 Tage)
│   │   ├── fc-flow-graph.js     # SVG-Graph der Flow-Struktur mit Stub-Knoten und Kopier-Buttons
│   │   ├── fc-exception-list.js # Paginierte Exception-Tabelle mit Datumsfilter und Stacktrace
│   │   ├── fc-exception-chart.js # SVG-Liniendiagramm: Exceptions pro Tag (14 Tage)
│   │   ├── fc-queue-list.js     # Queue-Tabelle mit JSON-Payload-Vorschau
│   │   ├── fc-queue-chart.js    # Live-Sparkline der Queue-Größe (Poll alle 3s)
│   │   ├── fc-source-viewer.js  # Readonly CodeMirror-Editor für PHP-Sourcecode
│   │   └── fc-json-editor.js    # CodeMirror JSON-Editor mit Live-Linting
│   ├── services/
│   │   ├── api.js               # HTTP-Client für die FlowCrafter-API + AI-Analyse (NDJSON-Streaming)
│   │   ├── auth.js              # Login / Logout / Passwort-Verwaltung
│   │   ├── connection.js        # FlowCrafter-Service-URL speichern & prüfen
│   │   ├── runs.js              # Hilfsfunktion: Flows nach Runtime-Hash gruppieren
│   │   ├── run-diff.js          # Diff-Logik zum Vergleich zweier Runs (Stub-Status, Messages, Results)
│   │   └── theme.js             # Dark/Light-Theme (localStorage)
│   ├── assets/
│   │   └── logo.js              # SVG-Logo als Lit-Template
│   ├── base-element.js          # Lit BaseElement (Shadow DOM deaktiviert)
│   ├── main.js                  # Einstiegspunkt
│   └── main.css                 # Tailwind + DaisyUI
├── server.js                    # Node-Server: Auth, Connection, AI-Config, Analyse-Proxy, Prometheus-Metriken
├── index.html
├── vite.config.js               # Tailwind-Plugin + Proxy-Config → :3000
└── package.json
```

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
| GET     | `/metrics`                  | Prometheus-Metriken (siehe unten)     |

---

## Monitoring

Der Node.js-Server stellt unter `GET /metrics` einen Prometheus-kompatiblen Endpoint bereit (kein Auth erforderlich):

| Metrik                                         | Typ     | Beschreibung                                    |
| ---------------------------------------------- | ------- | ----------------------------------------------- |
| `flowcrafter_ui_uptime_seconds`                | Gauge   | Uptime des Node-Servers in Sekunden             |
| `flowcrafter_ui_http_requests_total`           | Counter | HTTP-Requests nach `method`, `path` und `status` |
| `flowcrafter_ui_http_request_duration_ms_total` | Counter | Gesamt-Dauer aller Requests in ms nach Route    |
| `flowcrafter_ui_http_request_duration_ms_count` | Counter | Anzahl Requests pro Route                       |

Pfade werden normalisiert (`/api/auth/*`, `/api/fc/*`, `/static`), um die Label-Kardinalität niedrig zu halten.

---

## KI-Analyse

Die optionale KI-Analyse nutzt die Anthropic API, um Flows automatisch zu bewerten:

- **Konfiguration** über die UI (API-Key + Modellauswahl) — gespeichert als AES-256-GCM-verschlüsselte Datei auf dem Server
- **Unterstützte Modelle:** Claude Sonnet 4, Claude Opus 4, Claude Haiku 4.5
- **Analyse-Ablauf:** Flow-Daten werden an Claude gesendet; Claude kann per Tool-Use PHP-Stub-Sourcecode nachladen und liefert strukturierte Findings (Fehler, Warnungen, Performance, Info) mit Schweregrad zurück
- **Ergebnisse** werden im Flow-Detail als kategorisierte Karten mit betroffenen Stubs angezeigt

---

## Docker Compose

Drei vorkonfigurierte Compose-Files starten den kompletten Stack (Storage + FlowCrafter API/Observer + UI) mit einem Befehl:

```bash
# Redis
docker compose -f docker-compose.redis.yml up

# MySQL
docker compose -f docker-compose.mysql.yml up

# EventSourcingDB
docker compose -f docker-compose.esdb.yml up
```

| File                       | Storage         | Ports                                  |
| -------------------------- | --------------- | -------------------------------------- |
| `docker-compose.redis.yml` | Redis Stack     | Redis `:6379`, API `:8000`, UI `:3000` |
| `docker-compose.mysql.yml` | MySQL 8.0       | MySQL `:3306`, API `:8000`, UI `:3000` |
| `docker-compose.esdb.yml`  | EventSourcingDB | ESDB `:3001`, API `:8000`, UI `:3000`  |

> **Hinweis:** Bei EventSourcingDB muss vor dem ersten Start `vendor/bin/flowcrafter init` ausgeführt werden.

---

## Hinweise

- **Shadow DOM** ist in allen Komponenten deaktiviert (`BaseElement.createRenderRoot()` gibt `this` zurück), damit globale Tailwind/DaisyUI-Klassen greifen.
- **Queue-Chart** pollt alle 3 Sekunden `/api/queue/count` und zeigt eine Live-Sparkline in der Navbar.
- **Suche** in der Navbar erkennt automatisch ob ein UUID-Hash oder ein Freitext eingegeben wird. UUIDs werden als `flowHash` / `runtimeHash` aufgelöst, alle anderen Eingaben lösen eine `flowSubject`-Suche aus. Bei mehreren Treffern erscheint ein Dropdown mit den ersten Ergebnissen; bei genau einem Treffer wird direkt zum Flow navigiert.
- **Flow-Graph** (`fc-flow-graph`) stellt die Stub-Knoten des Flows als SVG-Diagramm dar und erlaubt das manuelle Auslösen eines Stubs via JSON-Editor-Modal. Wenn eine Message-Source von mehreren Stubs konsumiert wird, öffnet sich ein Auswahl-Modal zur selektiven Stub-Ausführung (`includeStubs`). Jeder angezeigte Message-Inhalt (ein- und ausgehend) besitzt einen Kopier-Button, der den JSON-Inhalt in die Zwischenablage kopiert.
- **Run-Vergleich** per Drag & Drop: In der Flow-Detail-Ansicht kann ein Run auf einen anderen gezogen werden, um ein Diff-Modal zu öffnen. Dieses zeigt pro Stub den Status-Vergleich, eingehende/ausgehende Message-Diffs (Payload-Felder mit Änderungs-Hervorhebung), FlowResult-Vergleich und Exceptions beider Runs.
- **Overview** (`fc-overview`) zeigt alle registrierten Flow-Schemas mit ihren Stubs, inklusive PHP-Source-Viewer und Graph-Ansicht.
