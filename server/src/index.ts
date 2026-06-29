import http from "node:http";
import cors from "cors";
import express from "express";
import { Server } from "socket.io";
import { isMeetingCode, normalizeMeetingCode } from "./ids.js";
import { getSeedRooms, getSeedUsers } from "./seed.js";
import {
  addMessage,
  approvePendingParticipant,
  cleanupExpiredRooms,
  createRoom,
  denyPendingParticipant,
  getMessages,
  getParticipant,
  getPublicPendingParticipants,
  getPublicParticipants,
  getRoom,
  leaveRoom,
  listRooms,
  requestJoinRoom,
  serializeRoom,
  updateMediaState
} from "./store.js";
import type { MediaState } from "./types.js";

const port = Number(process.env.PORT ?? 5000);
const host = process.env.HOST ?? "0.0.0.0";
const clientOrigin =  "http://127.0.0.1:3000";

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
  res.status(201).json({ room: serializeRoom(room), hostToken: room.hostToken });
});

app.get("/api/meetings/:roomId", (req, res) => {
  const roomId = normalizeMeetingCode(req.params.roomId);
  if (!isMeetingCode(roomId)) {
    res.status(400).json({ message: "Meeting code must use the format uih-hhd-erb" });
    return;
  }

  const room = getRoom(roomId);
  if (!room) {
    res.status(404).json({ message: "Meeting not found or expired" });
    return;
  }

  res.json({
    room: serializeRoom(room),
    participants: getPublicParticipants(room.id),
    pendingParticipants: getPublicPendingParticipants(room.id),
    messages: getMessages(room.id)
  });
});

app.post("/api/meetings/:roomId/join", (req, res) => {
  const roomId = normalizeMeetingCode(req.params.roomId);
  if (!isMeetingCode(roomId)) {
    res.status(400).json({ message: "Meeting code must use the format uih-hhd-erb" });
    return;
  }

  const room = getRoom(roomId);
  if (!room) {
    res.status(404).json({ message: "Meeting not found or expired" });
    return;
  }

  res.json({ room: serializeRoom(room) });
});

io.on("connection", (socket) => {
  socket.on("request-join", (payload: { roomId: string; displayName: string; media: MediaState; hostToken?: string }, ack) => {
    const roomId = normalizeMeetingCode(payload.roomId);
    if (!isMeetingCode(roomId)) {
      ack?.({ ok: false, message: "Meeting code must use the format uih-hhd-erb" });
      return;
    }

    const result = requestJoinRoom(roomId, socket.id, payload.displayName, payload.media, payload.hostToken);
    const room = getRoom(roomId);

    if (!result || !room) {
      ack?.({ ok: false, message: "Meeting not found or expired" });
      return;
    }

    if (result.autoApproved && result.participant) {
      socket.join(roomId);
      ack?.({
        ok: true,
        status: "approved",
        selfId: socket.id,
        room: serializeRoom(room),
        participants: getPublicParticipants(roomId),
        pendingParticipants: getPublicPendingParticipants(roomId),
        messages: getMessages(roomId)
      });
      return;
    }

    ack?.({
      ok: true,
      status: "waiting",
      room: serializeRoom(room)
    });

    if (result.pending && room.hostId) {
      io.to(room.hostId).emit("join-requested", { pendingParticipant: result.pending });
    }
  });

  socket.on("approve-join", (payload: { roomId: string; pendingId: string }, ack) => {
    const roomId = normalizeMeetingCode(payload.roomId);
    if (!isMeetingCode(roomId)) {
      ack?.({ ok: false, message: "Meeting code must use the format uih-hhd-erb" });
      return;
    }

    const result = approvePendingParticipant(roomId, payload.pendingId, socket.id);
    if (!result) {
      ack?.({ ok: false, message: "Only the host can admit this participant." });
      return;
    }

    const pendingSocket = io.sockets.sockets.get(result.participant.socketId);
    pendingSocket?.join(roomId);

    const room = serializeRoom(result.room);
    const participants = getPublicParticipants(roomId);
    const pendingParticipants = getPublicPendingParticipants(roomId);

    pendingSocket?.emit("join-approved", {
      selfId: result.participant.id,
      room,
      participants,
      pendingParticipants,
      messages: getMessages(roomId)
    });

    pendingSocket?.to(roomId).emit("participant-joined", {
      participant: {
        id: result.participant.id,
        socketId: result.participant.socketId,
        displayName: result.participant.displayName,
        joinedAt: result.participant.joinedAt,
        media: result.participant.media
      },
      room
    });

    io.to(roomId).emit("pending-participant-removed", {
      pendingId: payload.pendingId,
      pendingParticipants,
      room
    });

    ack?.({ ok: true });
  });

  socket.on("deny-join", (payload: { roomId: string; pendingId: string }, ack) => {
    const roomId = normalizeMeetingCode(payload.roomId);
    if (!isMeetingCode(roomId)) {
      ack?.({ ok: false, message: "Meeting code must use the format uih-hhd-erb" });
      return;
    }

    const result = denyPendingParticipant(roomId, payload.pendingId, socket.id);
    if (!result) {
      ack?.({ ok: false, message: "Only the host can deny this participant." });
      return;
    }

    io.to(result.pending.socketId).emit("join-denied", {
      message: "The host did not admit you to this meeting."
    });

    const room = serializeRoom(result.room);
    io.to(roomId).emit("pending-participant-removed", {
      pendingId: payload.pendingId,
      pendingParticipants: getPublicPendingParticipants(roomId),
      room
    });

    ack?.({ ok: true });
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

    if (result.pending) {
      socket.to(result.room.id).emit("pending-participant-removed", {
        pendingId: result.pending.id,
        pendingParticipants: getPublicPendingParticipants(result.room.id),
        room: serializeRoom(result.room)
      });
      return;
    }

    if (!result.participant) {
      return;
    }

    socket.to(result.room.id).emit("participant-left", {
      participantId: result.participant.id,
      room: serializeRoom(result.room)
    });

    if (result.hostChanged) {
      socket.to(result.room.id).emit("host-changed", {
        room: serializeRoom(result.room)
      });
    }
  });
});

setInterval(cleanupExpiredRooms, 60 * 1000).unref();

server.listen(port, host, () => {
  console.log(`Meet API running at http://${host}:${port}`);
});
