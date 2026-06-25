# Peace Mind Meet API

Deploy this folder as the backend root on a persistent Node.js host such as Render, Railway, Fly.io, or a VPS.

Do not use Vercel for this backend. The API uses Express, Socket.IO WebSockets, and in-memory meeting state, which need a long-running server process.

## Deploy Settings

Root directory:

```txt
server
```

Build command:

```bash
npm install && npm run build
```

Start command:

```bash
npm run start
```

Environment variables:

```env
CLIENT_ORIGIN=https://your-frontend.vercel.app
PORT=4000
```

## Health Checks

```txt
/
/health
/api/bootstrap
```

The backend stores runtime data in memory. Meetings disappear when the service restarts, and the service should run as a single instance unless a shared state layer is added later.
