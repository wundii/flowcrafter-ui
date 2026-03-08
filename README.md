# FlowCrafter UI

Web-Frontend für [FlowCrafter](../flowcrafter) — visualisiert Flow-Instanzen, Messages und Exceptions aus dem PHP-Backend in Echtzeit.

## Stack

- [Lit v3](https://lit.dev/) — Web Components
- [Vite v6](https://vitejs.dev/) — Build-Tool / Dev-Server
- [Tailwind CSS v4](https://tailwindcss.com/) — Utility-CSS
- [DaisyUI v5](https://daisyui.com/) — Komponenten-Bibliothek
- [CodeMirror 6](https://codemirror.net/) — JSON-Editor mit Syntax-Highlighting & Linting

---

## Voraussetzungen

| Anforderung | Version |
|---|---|
| Node.js | >= 20 |
| npm | >= 10 |
| PHP | >= 8.1 (für die API) |

> Im Projekt wird Node/npm über den Docker-Container `default-php-wundiiii` bereitgestellt.
> Das Projektverzeichnis ist als Volume eingebunden — Dateiänderungen auf dem Host sind sofort im Container sichtbar.

---

## Inbetriebnahme

### 1. Abhängigkeiten installieren

```bash
docker exec default-php-wundiiii bash -c "cd /var/www/flowcrafter-ui && npm install"
```

### 2. Umgebungsvariablen konfigurieren

```bash
cp .env.example .env
```

`.env` anpassen:

```env
# URL zur FlowCrafter PHP-API
VITE_API_URL=http://localhost:8000
```

### 3. PHP-API starten

Die API liegt im FlowCrafter-Hauptprojekt:

```bash
cd ~/Projekte/flowcrafter
php -S localhost:8000 service/index.php
```

### 4. Dev-Server starten

```bash
docker exec default-php-wundiiii bash -c "cd /var/www/flowcrafter-ui && npm run dev"
```

Frontend erreichbar unter: **http://localhost:5173**

---

## Verfügbare Scripts

| Befehl | Beschreibung |
|---|---|
| `npm run dev` | Dev-Server mit Hot-Reload starten |
| `npm run build` | Produktions-Build nach `dist/` |
| `npm run preview` | Produktions-Build lokal vorschauen |

Alle Befehle über Docker ausführen:

```bash
docker exec default-php-wundiiii bash -c "cd /var/www/flowcrafter-ui && npm run <script>"
```

---

## Projektstruktur

```
flowcrafter-ui/
├── src/
│   ├── components/
│   │   ├── fc-app.js            # Root-Komponente, Navigation/Tabs
│   │   ├── fc-flow-list.js      # Tabelle aller Flow-Instanzen
│   │   ├── fc-flow-detail.js    # Detail-Ansicht inkl. Runs-Panel
│   │   ├── fc-flow-graph.js     # SVG-Graph + Stub-Knoten + Modal
│   │   ├── fc-json-editor.js    # CodeMirror JSON-Editor Wrapper
│   │   └── fc-exception-list.js # Tabelle aller Exceptions
│   ├── services/
│   │   ├── api.js               # HTTP-Client für die PHP-API
│   │   └── dummy-runs.js        # Dummy-Run-Generator (bis API-Endpoint fertig)
│   ├── base-element.js          # Lit BaseElement (Shadow DOM deaktiviert)
│   ├── main.js                  # Einstiegspunkt
│   └── main.css                 # Tailwind + DaisyUI
├── index.html
├── vite.config.js
└── .env.example
```

---

## API-Endpunkte

Die PHP-API (`flowcrafter/service/index.php`) stellt folgende Routen bereit:

| Methode | Pfad | Parameter | Beschreibung |
|---|---|---|---|
| GET | `/` | — | Health Check |
| GET | `/api/flows` | `sort`, `top`, `source` | Alle Flow-Instanzen |
| GET | `/api/flows/detail` | `hash` | Flow mit Messages & Exceptions |
| GET | `/api/exceptions` | `sort`, `top`, `flowHash` | Alle Exceptions |

---

## Hinweise

- **Shadow DOM** ist in allen Komponenten deaktiviert (`BaseElement.createRenderRoot()` gibt `this` zurück), damit globale Tailwind/DaisyUI-Klassen greifen.
- **Runs-Panel** zeigt aktuell Dummy-Daten — der echte API-Endpunkt für mehrere Runs pro Flow-Instanz ist in Entwicklung.
- **Message-Input-Editor** (Stub-Input-Modal) ist vorbereitet, der Senden-Button wird aktiviert sobald der entsprechende API-Endpunkt verfügbar ist.
