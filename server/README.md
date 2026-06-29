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

If your host requires the same backend build command used by the root project, this also works:

```bash
npm install && npm run server:build
```

Start command:

```bash
npm run start
```

Do not use the frontend build command here. If the deploy log says `Missing script: "client:generate"`, the backend project is using the wrong build command. Change it to:

```bash
npm install && npm run build
```

Environment variables:

```env
CLIENT_ORIGIN=https://your-frontend.vercel.app
PORT=5000
```

## Health Checks

```txt
/
/health
/api/bootstrap
```

The backend stores runtime data in memory. Meetings disappear when the service restarts, and the service should run as a single instance unless a shared state layer is added later.

Meeting codes are generated as lowercase letters in this format:

```txt
uih-hhd-erb
```

Socket.IO handles signaling and room events only. Browser media uses WebRTC SRTP, which normally travels over UDP through ICE.
