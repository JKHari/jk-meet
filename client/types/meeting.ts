export type MediaState = {
  audio: boolean;
  video: boolean;
  screen: boolean;
};

export type PublicParticipant = {
  id: string;
  socketId: string;
  displayName: string;
  joinedAt: number;
  media: MediaState;
};

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

export type PublicPendingParticipant = {
  id: string;
  socketId: string;
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

export type SeedRoom = {
  title: string;
  description: string;
};

export type SeedUser = {
  displayName: string;
  avatarColor: string;
};
