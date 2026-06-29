import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { SeedRoom, SeedUser } from "./types.js";

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataRoots = [path.join(serverRoot, "data"), path.resolve(process.cwd(), "server", "data"), path.resolve(process.cwd(), "data")];

let roomsCache: Promise<SeedRoom[]> | null = null;
let usersCache: Promise<SeedUser[]> | null = null;

async function readJson<T>(fileName: string): Promise<T> {
  let lastError: unknown;

  for (const dataRoot of dataRoots) {
    try {
      const raw = await readFile(path.join(dataRoot, fileName), "utf8");
      return JSON.parse(raw) as T;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

export function getSeedRooms() {
  roomsCache ??= readJson<SeedRoom[]>("rooms.json");
  return roomsCache;
}

export function getSeedUsers() {
  usersCache ??= readJson<SeedUser[]>("users.json");
  return usersCache;
}
