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

Alle Nutzerdaten liegen ausschließlich im Browser (IndexedDB via `localforage`) und werden nie ins Repo oder Image geschrieben – es gibt nichts Persönliches, das vor dem Hochladen auf GitHub entfernt werden müsste.

### Image lokal bauen und starten

```bash
docker compose up --build
```

Die App ist danach unter `http://localhost:8080` erreichbar (Port lässt sich in `docker-compose.yml` anpassen).

### Image für Raspberry Pi (arm64) bauen und veröffentlichen

Auf einem x86-Rechner per `buildx` für die Pi-Architektur bauen und in eine Registry pushen (z. B. GitHub Container Registry):

```bash
docker buildx build --platform linux/arm64 -t ghcr.io/<dein-github-user>/finance-app:latest --push .
```

Auf dem Raspberry Pi dann nur noch ziehen und starten:

```bash
docker pull ghcr.io/<dein-github-user>/finance-app:latest
docker run -d --name finance-app --restart unless-stopped -p 8080:80 ghcr.io/<dein-github-user>/finance-app:latest
```

Alternativ mit der `docker-compose.yml` im Projekt-Root: `image:`-Zeile auf `ghcr.io/<dein-github-user>/finance-app:latest` setzen und `docker compose up -d` ausführen.

