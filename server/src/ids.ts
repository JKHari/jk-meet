import { randomBytes, randomUUID } from "node:crypto";

export function createEntityId(prefix: string) {
  return `${prefix}_${randomUUID()}`;
}

export function createHostToken() {
  return randomUUID();
}

export const meetingCodePattern = /^[a-z]{3}-[a-z]{3}-[a-z]{3}$/;

export function createMeetingCode() {
  const letters = "abcdefghijklmnopqrstuvwxyz";
  const bytes = randomBytes(9);
  const code = [...bytes].map((byte) => letters[byte % letters.length]).join("");
  return `${code.slice(0, 3)}-${code.slice(3, 6)}-${code.slice(6, 9)}`;
}

export function normalizeMeetingCode(value: string) {
  return value.trim().toLowerCase();
}

export function isMeetingCode(value: string) {
  return meetingCodePattern.test(value);
}
