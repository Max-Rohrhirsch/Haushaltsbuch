# FinanceApp

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 21.2.21.

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Vitest](https://vitest.dev/) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.

## Docker (z. B. für Raspberry Pi)

Alle Daten liegen primär im Browser (IndexedDB via `localforage`) und funktionieren komplett offline. Sobald ein Backend erreichbar ist, gleicht die App die Daten automatisch ab (`src/app/data/sync.service.ts`), damit sie zwischen Handy und Raspberry Pi synchron bleiben. Es gibt keine Nutzerdaten im Repo oder Image – der Sync-Server persistiert alles ausschließlich in einem separaten Docker-Volume auf dem Pi.

Das Compose-Setup startet zwei Container:
- `finance-app`: Angular-PWA hinter nginx (Port 8080), proxyt `/api/*` intern an den Backend-Container.
- `finance-backend`: kleiner Node/Express-Server (`backend/`), der die Daten als JSON in `/data` (Docker-Volume `finance-data`) ablegt.

### Lokal bauen und starten

```bash
docker compose up --build
```

Die App ist danach unter `http://localhost:8080` erreichbar (Port lässt sich in `docker-compose.yml` anpassen). Für die lokale Entwicklung ohne Docker: `npm start` (Angular Dev-Server) und parallel `npm start` in `backend/` – `proxy.conf.json` leitet `/api` dabei automatisch an `http://localhost:4300` weiter.

### Images für Raspberry Pi (arm64) bauen und veröffentlichen

Auf einem x86-Rechner per `buildx` für die Pi-Architektur bauen und in eine Registry pushen (z. B. GitHub Container Registry):

```bash
docker buildx build --platform linux/arm64 -t ghcr.io/<dein-github-user>/finance-app:latest --push .
docker buildx build --platform linux/arm64 -t ghcr.io/<dein-github-user>/finance-backend:latest --push ./backend
```

Auf dem Raspberry Pi reicht dann `docker-compose.yml`, bei der die `build:`-Blöcke durch `image: ghcr.io/<dein-github-user>/finance-app:latest` bzw. `finance-backend:latest` ersetzt werden:

```bash
docker compose pull
docker compose up -d
```

### Als "App" auf dem Handy nutzen

Die Seite im mobilen Browser öffnen und über "Zum Startbildschirm hinzufügen" installieren (PWA). Der Service Worker cached die App-Shell für den Offline-Betrieb; Buchungen werden lokal gespeichert und automatisch synchronisiert, sobald wieder Internet/WLAN zum Raspberry Pi besteht (Status siehe Badge oben rechts im Header).

