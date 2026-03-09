# FlowCrafter UI

Web-Frontend für [FlowCrafter](../flowcrafter) — visualisiert Flow-Instanzen, Messages, Exceptions und Queue-Status aus dem PHP-Backend in Echtzeit.

## Stack

- [Lit v3](https://lit.dev/) — Web Components
- [Vite v6](https://vitejs.dev/) — Build-Tool / Dev-Server
- [Tailwind CSS v4](https://tailwindcss.com/) — Utility-CSS
- [DaisyUI v5](https://daisyui.com/) — Komponenten-Bibliothek
- [CodeMirror 6](https://codemirror.net/) — JSON-Editor mit Syntax-Highlighting & Linting

---

## Architektur

Das UI kommuniziert mit **zwei Backends**:

| Backend | Port | Zweck |
| ------- | ---- | ----- |
| Node.js-Proxy | `3000` | Auth-Verwaltung, Verbindungskonfiguration (wird im Dev-Server via Vite-Proxy auf `/api/auth` und `/api/connection` weitergeleitet) |
| FlowCrafter-API | konfigurierbar | Flow-Daten, Exceptions, Queue — URL wird im Node-Backend gespeichert |

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

---

## Verfügbare Scripts

| Befehl            | Beschreibung                       |
| ----------------- | ---------------------------------- |
| `npm run dev`     | Dev-Server mit Hot-Reload starten  |
| `npm run build`   | Produktions-Build nach `dist/`     |
| `npm run preview` | Produktions-Build lokal vorschauen |

Alle Befehle über Docker ausführen:

```bash
npm run <script>
```

---

## Projektstruktur

```
flowcrafter-ui/
├── src/
│   ├── components/
│   │   ├── fc-app.js            # Root-Komponente: Navigation, Breadcrumb, Suche
│   │   ├── fc-login.js          # Login / Ersteinrichtung (Passwort)
│   │   ├── fc-service-setup.js  # FlowCrafter-Service-URL konfigurieren
│   │   ├── fc-schema-list.js    # Übersichtskacheln pro Flow-Klasse (Schema)
│   │   ├── fc-flow-list.js      # Tabelle aller Flow-Instanzen eines Schemas
│   │   ├── fc-flow-detail.js    # Detail-Ansicht: Runs, Messages, Exceptions
│   │   ├── fc-flow-graph.js     # SVG-Graph der Flow-Struktur + Stub-Input-Modal
│   │   ├── fc-exception-list.js # Tabelle aller Exceptions
│   │   ├── fc-queue-chart.js    # Live-Sparkline der Queue-Größe (Poll alle 3s)
│   │   └── fc-json-editor.js    # CodeMirror JSON-Editor Wrapper
│   ├── services/
│   │   ├── api.js               # HTTP-Client für die FlowCrafter-API
│   │   ├── auth.js              # Login / Logout / Passwort-Verwaltung
│   │   ├── connection.js        # FlowCrafter-Service-URL speichern & prüfen
│   │   ├── runs.js              # Hilfsfunktion: Flows nach Runtime-Hash gruppieren
│   │   └── theme.js             # Dark/Light-Theme (localStorage)
│   ├── assets/
│   │   └── logo.js              # SVG-Logo als Lit-Template
│   ├── base-element.js          # Lit BaseElement (Shadow DOM deaktiviert)
│   ├── main.js                  # Einstiegspunkt
│   └── main.css                 # Tailwind + DaisyUI
├── index.html
├── vite.config.js               # Tailwind-Plugin + Proxy /api/auth → :3000
└── package.json
```

---

## API-Endpunkte

### Node.js-Proxy (Auth & Verbindung)

| Methode | Pfad                        | Beschreibung                          |
| ------- | --------------------------- | ------------------------------------- |
| GET     | `/api/auth/status`          | Auth-Status + ob Passwort gesetzt ist |
| POST    | `/api/auth/setup`           | Erstes Passwort festlegen             |
| POST    | `/api/auth/login`           | Anmelden → JWT-Token                  |
| POST    | `/api/auth/logout`          | Abmelden                              |
| POST    | `/api/auth/change-password` | Passwort ändern                       |
| GET     | `/api/connection`           | Gespeicherte Service-URL abrufen      |
| POST    | `/api/connection`           | Service-URL & Secret speichern        |
| DELETE  | `/api/connection`           | Verbindung zurücksetzen               |

---

## Hinweise

- **Shadow DOM** ist in allen Komponenten deaktiviert (`BaseElement.createRenderRoot()` gibt `this` zurück), damit globale Tailwind/DaisyUI-Klassen greifen.
- **Queue-Chart** pollt alle 3 Sekunden `/api/queue/count` und zeigt eine Live-Sparkline in der Navbar.
- **Hash-Suche** in der Navbar akzeptiert sowohl `flowHash` als auch `runtimeHash` — bei `runtimeHash` wird automatisch der zugehörige Flow aufgelöst.
- **Flow-Graph** (`fc-flow-graph`) stellt die Stub-Knoten des Flows als SVG-Diagram dar und erlaubt das manuelle Auslösen eines Stubs via JSON-Editor-Modal.
