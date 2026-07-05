# @parley/web

React-Frontend (Vite, TailwindCSS 4, Zustand).

## Entwicklung

```bash
npm run dev -w @parley/web    # Dev-Server auf http://localhost:5173
npm run build -w @parley/web  # Typecheck + Produktions-Build nach dist/
```

Im Dev-Modus werden `/api`-Anfragen per Vite-Proxy an das Backend (Port 3001) weitergeleitet – dadurch ist kein CORS nötig. Das Backend sollte also parallel laufen (`npm run dev:api` im Root).
