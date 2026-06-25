import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SeedRoom, SeedUser } from "./types.js";

const dataRoot = path.resolve(process.cwd(), "data");

let roomsCache: Promise<SeedRoom[]> | null = null;
let usersCache: Promise<SeedUser[]> | null = null;

async function readJson<T>(fileName: string): Promise<T> {
  const raw = await readFile(path.join(dataRoot, fileName), "utf8");
  return JSON.parse(raw) as T;
}

export function getSeedRooms() {
  roomsCache ??= readJson<SeedRoom[]>("rooms.json");
  return roomsCache;
}

export function getSeedUsers() {
  usersCache ??= readJson<SeedUser[]>("users.json");
  return usersCache;
}
