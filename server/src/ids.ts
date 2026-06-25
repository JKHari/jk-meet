import { randomBytes, randomUUID } from "node:crypto";

export function createEntityId(prefix: string) {
  return `${prefix}_${randomUUID()}`;
}

export function createMeetingCode() {
  const raw = randomBytes(5).toString("base64url").replace(/[^a-zA-Z0-9]/g, "");
  return raw.slice(0, 9).replace(/(.{3})(.{3})(.{3})/, "$1-$2-$3").toLowerCase();
}
