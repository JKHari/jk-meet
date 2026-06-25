# Peace Mind Meet

Google Meet-style prototype using Nuxt 3, Vue 3, Tailwind CSS, Node.js, Express, Socket.IO, and WebRTC.

Runtime meeting data is intentionally kept in memory:

- No database
- No Redis
- No Kafka
- JSON files are used only as seed/mock data

## Run

```bash
npm install
npm run dev
```

Frontend: `http://127.0.0.1:3000`

Backend: `http://127.0.0.1:4000`

## Deploy Roots

Frontend root directory: `.`, using `vercel.json`. Set `NUXT_PUBLIC_API_BASE` in Vercel to your backend URL.

Backend root directory: `server`, with build command `npm run build` and start command `npm run start`.

## Architecture

- `data/*.json`: seed users and meeting templates
- `server/src/store.ts`: in-memory room, participant, and message Maps
- `server/src/index.ts`: Express REST API and Socket.IO signaling server
- `client/pages/index.vue`: create/join meeting screen
- `client/pages/meeting/[roomId].vue`: media preview, WebRTC mesh room, chat, participants

This version uses browser WebRTC mesh. It is suitable for small meetings and prototypes. Larger rooms would need an SFU such as mediasoup.
