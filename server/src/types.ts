export type MediaState = {
  audio: boolean;
  video: boolean;
  screen: boolean;
};

export type ParticipantState = {
  id: string;
  socketId: string;
  roomId: string;
  displayName: string;
  joinedAt: number;
  media: MediaState;
};

export type PendingParticipantState = {
  id: string;
  socketId: string;
  roomId: string;
  displayName: string;
  requestedAt: number;
  media: MediaState;
};

export type ChatMessage = {
  id: string;
  roomId: string;
  senderId: string;
  senderName: string;
  body: string;
  createdAt: number;
};

export type RoomState = {
  id: string;
  title: string;
  hostName: string;
  hostToken: string;
  hostId: string | null;
  createdAt: number;
  expiresAt: number;
  participants: Map<string, ParticipantState>;
  pendingParticipants: Map<string, PendingParticipantState>;
};

export type PublicParticipant = Omit<ParticipantState, "roomId">;
export type PublicPendingParticipant = Omit<PendingParticipantState, "roomId">;

export type PublicRoom = {
  id: string;
  title: string;
  hostName: string;
  hostId: string | null;
  createdAt: number;
  expiresAt: number;
  participantCount: number;
  pendingCount: number;
};

export type SeedRoom = {
  title: string;
  description: string;
};

export type SeedUser = {
  displayName: string;
  avatarColor: string;
};
