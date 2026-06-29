import { createEntityId, createHostToken, createMeetingCode } from "./ids.js";
import type {
  ChatMessage,
  MediaState,
  PendingParticipantState,
  PublicPendingParticipant,
  ParticipantState,
  PublicParticipant,
  PublicRoom,
  RoomState
} from "./types.js";

const roomTtlMs = 60 * 60 * 1000;
const emptyRoomGraceMs = 30 * 1000;
const maxMessagesPerRoom = 100;

const rooms = new Map<string, RoomState>();
const messages = new Map<string, ChatMessage[]>();
const emptyRoomTimers = new Map<string, NodeJS.Timeout>();
const roomSnapshotCache = new Map<string, { version: number; room: PublicRoom }>();
const roomVersions = new Map<string, number>();

function bumpRoomVersion(roomId: string) {
  roomVersions.set(roomId, (roomVersions.get(roomId) ?? 0) + 1);
  roomSnapshotCache.delete(roomId);
}

function serializeParticipant(participant: ParticipantState): PublicParticipant {
  const { roomId: _roomId, ...publicParticipant } = participant;
  return publicParticipant;
}

function serializePendingParticipant(participant: PendingParticipantState): PublicPendingParticipant {
  const { roomId: _roomId, ...publicParticipant } = participant;
  return publicParticipant;
}

export function serializeRoom(room: RoomState): PublicRoom {
  const version = roomVersions.get(room.id) ?? 0;
  const cached = roomSnapshotCache.get(room.id);
  if (cached?.version === version) {
    return cached.room;
  }

  const publicRoom: PublicRoom = {
    id: room.id,
    title: room.title,
    hostName: room.hostName,
    hostId: room.hostId,
    createdAt: room.createdAt,
    expiresAt: room.expiresAt,
    participantCount: room.participants.size,
    pendingCount: room.pendingParticipants.size
  };

  roomSnapshotCache.set(room.id, { version, room: publicRoom });
  return publicRoom;
}

export function listRooms() {
  return [...rooms.values()].map(serializeRoom);
}

export function getRoom(roomId: string) {
  return rooms.get(roomId);
}

export function createRoom(hostName: string, title?: string) {
  let roomId = createMeetingCode();
  while (rooms.has(roomId)) {
    roomId = createMeetingCode();
  }

  const now = Date.now();
  const room: RoomState = {
    id: roomId,
    title: title?.trim() || `${hostName.trim() || "Guest"}'s meeting`,
    hostName: hostName.trim() || "Guest",
    hostToken: createHostToken(),
    hostId: null,
    createdAt: now,
    expiresAt: now + roomTtlMs,
    participants: new Map(),
    pendingParticipants: new Map()
  };

  rooms.set(roomId, room);
  messages.set(roomId, []);
  bumpRoomVersion(roomId);
  return room;
}

export function joinRoom(roomId: string, socketId: string, displayName: string, media: MediaState) {
  const room = rooms.get(roomId);
  if (!room) {
    return null;
  }

  const existingTimer = emptyRoomTimers.get(roomId);
  if (existingTimer) {
    clearTimeout(existingTimer);
    emptyRoomTimers.delete(roomId);
  }

  const participant: ParticipantState = {
    id: socketId,
    socketId,
    roomId,
    displayName: displayName.trim() || "Guest",
    joinedAt: Date.now(),
    media
  };

  room.participants.set(socketId, participant);
  if (!room.hostId || room.participants.size === 1) {
    room.hostId = socketId;
    room.hostName = participant.displayName;
  }
  bumpRoomVersion(roomId);
  return participant;
}

export function requestJoinRoom(
  roomId: string,
  socketId: string,
  displayName: string,
  media: MediaState,
  hostToken?: string
) {
  const room = rooms.get(roomId);
  if (!room) {
    return null;
  }

  const isCreator = Boolean(hostToken && hostToken === room.hostToken);
  if (isCreator) {
    const participant = joinRoom(roomId, socketId, displayName, media);
    return participant ? { room, participant, pending: null, autoApproved: true } : null;
  }

  const existingPending = room.pendingParticipants.get(socketId);
  if (existingPending) {
    return { room, participant: null, pending: existingPending, autoApproved: false };
  }

  const pending: PendingParticipantState = {
    id: socketId,
    socketId,
    roomId,
    displayName: displayName.trim() || "Guest",
    requestedAt: Date.now(),
    media
  };

  room.pendingParticipants.set(socketId, pending);
  bumpRoomVersion(roomId);
  return { room, participant: null, pending, autoApproved: false };
}

export function approvePendingParticipant(roomId: string, pendingId: string, approverSocketId: string) {
  const room = rooms.get(roomId);
  if (!room || room.hostId !== approverSocketId) {
    return null;
  }

  const pending = room.pendingParticipants.get(pendingId);
  if (!pending) {
    return null;
  }

  room.pendingParticipants.delete(pendingId);
  const participant: ParticipantState = {
    id: pending.id,
    socketId: pending.socketId,
    roomId,
    displayName: pending.displayName,
    joinedAt: Date.now(),
    media: pending.media
  };

  room.participants.set(participant.socketId, participant);
  bumpRoomVersion(roomId);
  return { room, participant };
}

export function denyPendingParticipant(roomId: string, pendingId: string, approverSocketId: string) {
  const room = rooms.get(roomId);
  if (!room || room.hostId !== approverSocketId) {
    return null;
  }

  const pending = room.pendingParticipants.get(pendingId);
  if (!pending) {
    return null;
  }

  room.pendingParticipants.delete(pendingId);
  bumpRoomVersion(roomId);
  return { room, pending };
}

export function updateMediaState(socketId: string, media: MediaState) {
  for (const room of rooms.values()) {
    const participant = room.participants.get(socketId);
    if (!participant) {
      continue;
    }

    participant.media = media;
    bumpRoomVersion(room.id);
    return participant;
  }

  return null;
}

export function leaveRoom(socketId: string) {
  for (const room of rooms.values()) {
    const pending = room.pendingParticipants.get(socketId);
    if (pending) {
      room.pendingParticipants.delete(socketId);
      bumpRoomVersion(room.id);
      return { room, participant: null, pending, hostChanged: false };
    }

    const participant = room.participants.get(socketId);
    if (!participant) {
      continue;
    }

    room.participants.delete(socketId);
    const wasHost = room.hostId === socketId;
    if (wasHost) {
      const nextHost = room.participants.values().next().value as ParticipantState | undefined;
      room.hostId = nextHost?.id ?? null;
      room.hostName = nextHost?.displayName ?? room.hostName;
    }
    bumpRoomVersion(room.id);

    if (room.participants.size === 0) {
      const timer = setTimeout(() => deleteRoom(room.id), emptyRoomGraceMs);
      emptyRoomTimers.set(room.id, timer);
    }

    return { room, participant, pending: null, hostChanged: wasHost };
  }

  return null;
}

export function addMessage(roomId: string, sender: ParticipantState, body: string) {
  const trimmed = body.trim();
  if (!trimmed) {
    return null;
  }

  const message: ChatMessage = {
    id: createEntityId("msg"),
    roomId,
    senderId: sender.id,
    senderName: sender.displayName,
    body: trimmed.slice(0, 1000),
    createdAt: Date.now()
  };

  const roomMessages = messages.get(roomId) ?? [];
  roomMessages.push(message);
  messages.set(roomId, roomMessages.slice(-maxMessagesPerRoom));
  return message;
}

export function getMessages(roomId: string) {
  return messages.get(roomId) ?? [];
}

export function getParticipant(socketId: string) {
  for (const room of rooms.values()) {
    const participant = room.participants.get(socketId);
    if (participant) {
      return participant;
    }
  }

  return null;
}

export function getPublicParticipants(roomId: string) {
  const room = rooms.get(roomId);
  return room ? [...room.participants.values()].map(serializeParticipant) : [];
}

export function getPublicPendingParticipants(roomId: string) {
  const room = rooms.get(roomId);
  return room ? [...room.pendingParticipants.values()].map(serializePendingParticipant) : [];
}

export function deleteRoom(roomId: string) {
  const timer = emptyRoomTimers.get(roomId);
  if (timer) {
    clearTimeout(timer);
    emptyRoomTimers.delete(roomId);
  }

  rooms.delete(roomId);
  messages.delete(roomId);
  roomVersions.delete(roomId);
  roomSnapshotCache.delete(roomId);
}

export function cleanupExpiredRooms() {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.expiresAt <= now) {
      deleteRoom(room.id);
    }
  }
}
