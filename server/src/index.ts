import http from "node:http";
import cors from "cors";
import express from "express";
import { Server } from "socket.io";
import { getSeedRooms, getSeedUsers } from "./seed.js";
import {
  addMessage,
  cleanupExpiredRooms,
  createRoom,
  getMessages,
  getParticipant,
  getPublicParticipants,
  getRoom,
  joinRoom,
  leaveRoom,
  listRooms,
  serializeRoom,
  updateMediaState
} from "./store.js";
import type { MediaState } from "./types.js";

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "0.0.0.0";
const clientOrigin = process.env.CLIENT_ORIGIN ?? "http://127.0.0.1:3000";

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: clientOrigin,
    methods: ["GET", "POST"]
  }
});

app.use(cors({ origin: clientOrigin }));
app.use(express.json());

app.get("/", (_req, res) => {
  res.json({
    name: "Peace Mind Meet API",
    ok: true,
    storage: "in-memory",
    endpoints: ["/health", "/api/bootstrap", "/api/meetings"]
  });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, storage: "in-memory", redis: false, database: false });
});

app.get("/api/bootstrap", async (_req, res, next) => {
  try {
    const [seedRooms, seedUsers] = await Promise.all([getSeedRooms(), getSeedUsers()]);
    res.json({
      activeRooms: listRooms(),
      seedRooms,
      seedUsers
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/meetings", (req, res) => {
  const hostName = String(req.body?.hostName ?? "Guest");
  const title = typeof req.body?.title === "string" ? req.body.title : undefined;
  const room = createRoom(hostName, title);
  res.status(201).json({ room: serializeRoom(room) });
});

app.get("/api/meetings/:roomId", (req, res) => {
  const room = getRoom(req.params.roomId);
  if (!room) {
    res.status(404).json({ message: "Meeting not found or expired" });
    return;
  }

  res.json({
    room: serializeRoom(room),
    participants: getPublicParticipants(room.id),
    messages: getMessages(room.id)
  });
});

app.post("/api/meetings/:roomId/join", (req, res) => {
  const room = getRoom(req.params.roomId);
  if (!room) {
    res.status(404).json({ message: "Meeting not found or expired" });
    return;
  }

  res.json({ room: serializeRoom(room) });
});

io.on("connection", (socket) => {
  socket.on("join-room", (payload: { roomId: string; displayName: string; media: MediaState }, ack) => {
    const participant = joinRoom(payload.roomId, socket.id, payload.displayName, payload.media);
    const room = getRoom(payload.roomId);

    if (!participant || !room) {
      ack?.({ ok: false, message: "Meeting not found or expired" });
      return;
    }

    socket.join(payload.roomId);
    const participants = getPublicParticipants(payload.roomId);

    ack?.({
      ok: true,
      selfId: socket.id,
      room: serializeRoom(room),
      participants,
      messages: getMessages(payload.roomId)
    });

    socket.to(payload.roomId).emit("participant-joined", {
      participant: {
        id: participant.id,
        socketId: participant.socketId,
        displayName: participant.displayName,
        joinedAt: participant.joinedAt,
        media: participant.media
      }
    });
  });

  socket.on("media-state-changed", (media: MediaState) => {
    const participant = updateMediaState(socket.id, media);
    if (!participant) {
      return;
    }

    socket.to(participant.roomId).emit("media-state-changed", {
      participantId: participant.id,
      media
    });
  });

  socket.on("chat-message", (payload: { roomId: string; body: string }, ack) => {
    const sender = getParticipant(socket.id);
    if (!sender || sender.roomId !== payload.roomId) {
      ack?.({ ok: false });
      return;
    }

    const message = addMessage(payload.roomId, sender, payload.body);
    if (!message) {
      ack?.({ ok: false });
      return;
    }

    io.to(payload.roomId).emit("chat-message", message);
    ack?.({ ok: true });
  });

  socket.on("offer", (payload: { to: string; description: unknown }) => {
    socket.to(payload.to).emit("offer", { from: socket.id, description: payload.description });
  });

  socket.on("answer", (payload: { to: string; description: unknown }) => {
    socket.to(payload.to).emit("answer", { from: socket.id, description: payload.description });
  });

  socket.on("ice-candidate", (payload: { to: string; candidate: unknown }) => {
    socket.to(payload.to).emit("ice-candidate", { from: socket.id, candidate: payload.candidate });
  });

  socket.on("disconnect", () => {
    const result = leaveRoom(socket.id);
    if (!result) {
      return;
    }

    socket.to(result.room.id).emit("participant-left", {
      participantId: result.participant.id
    });
  });
});

setInterval(cleanupExpiredRooms, 60 * 1000).unref();

server.listen(port, host, () => {
  console.log(`Meet API running at http://${host}:${port}`);
});
