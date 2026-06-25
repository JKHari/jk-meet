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
  createdAt: number;
  expiresAt: number;
  participants: Map<string, ParticipantState>;
};

export type PublicParticipant = Omit<ParticipantState, "roomId">;

export type PublicRoom = {
  id: string;
  title: string;
  hostName: string;
  createdAt: number;
  expiresAt: number;
  participantCount: number;
};

export type SeedRoom = {
  title: string;
  description: string;
};

export type SeedUser = {
  displayName: string;
  avatarColor: string;
};
