<template>
  <main class="min-h-screen bg-meet-panel">
    <header class="flex h-16 items-center justify-between border-b border-meet-line bg-white px-5">
      <div class="flex items-center gap-3">
        <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-meet-blue text-white">
          <Video class="h-5 w-5" />
        </div>
        <div>
          <p class="text-sm font-semibold text-meet-ink">Peace Mind Meet</p>
          <p class="text-xs text-meet-muted">In-memory WebRTC meetings</p>
        </div>
      </div>
      <div class="hidden items-center gap-2 text-sm text-meet-muted sm:flex">
        <Users class="h-4 w-4" />
        <span>{{ activeRooms.length }} active rooms</span>
      </div>
    </header>

    <section class="mx-auto grid min-h-[calc(100vh-4rem)] max-w-6xl grid-cols-1 gap-8 px-5 py-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
      <div class="max-w-2xl">
        <p class="mb-3 text-sm font-medium text-meet-blue">Browser video meetings without DB or Redis</p>
        <h1 class="text-4xl font-semibold leading-tight text-meet-ink sm:text-5xl">
          Video calls that live entirely in memory.
        </h1>
        <p class="mt-5 max-w-xl text-base leading-7 text-meet-muted">
          Create a meeting, join with a code, test audio/video, chat, and exchange WebRTC signals through a Node.js server. Runtime state is stored in Maps and disappears when the server restarts.
        </p>

        <div class="mt-8 grid gap-3 sm:grid-cols-3">
          <button
            v-for="name in suggestedNames"
            :key="name"
            class="rounded-lg border border-meet-line bg-white px-4 py-3 text-left text-sm font-medium text-meet-ink transition hover:border-meet-blue"
            type="button"
            @click="displayName = name"
          >
            {{ name }}
          </button>
        </div>
      </div>

      <div class="rounded-lg border border-meet-line bg-white p-5 shadow-soft">
        <div class="space-y-4">
          <label class="block">
            <span class="mb-2 block text-sm font-medium text-meet-ink">Display name</span>
            <input
              v-model="displayName"
              class="h-12 w-full rounded-lg border border-meet-line px-4 outline-none transition focus:border-meet-blue focus:ring-2 focus:ring-blue-100"
              placeholder="Your name"
              type="text"
            />
          </label>

          <label class="block">
            <span class="mb-2 block text-sm font-medium text-meet-ink">Meeting title</span>
            <input
              v-model="meetingTitle"
              class="h-12 w-full rounded-lg border border-meet-line px-4 outline-none transition focus:border-meet-blue focus:ring-2 focus:ring-blue-100"
              placeholder="Team sync"
              type="text"
            />
          </label>

          <button
            class="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-meet-blue px-4 font-medium text-white transition hover:bg-blue-700 disabled:opacity-60"
            :disabled="loading"
            type="button"
            @click="createMeeting()"
          >
            <CalendarPlus class="h-5 w-5" />
            New meeting
          </button>

          <div class="grid gap-3 sm:grid-cols-[1fr_auto]">
            <input
              v-model="roomCode"
              class="h-12 rounded-lg border border-meet-line px-4 lowercase outline-none transition focus:border-meet-blue focus:ring-2 focus:ring-blue-100"
              placeholder="uih-hhd-erb"
              type="text"
              @keyup.enter="joinMeeting()"
            />
            <button
              class="flex h-12 items-center justify-center gap-2 rounded-lg border border-meet-line px-5 font-medium text-meet-ink transition hover:border-meet-blue disabled:opacity-60"
              :disabled="loading"
              type="button"
              @click="joinMeeting()"
            >
              <LogIn class="h-5 w-5" />
              Join
            </button>
          </div>

          <p v-if="errorMessage" class="rounded-lg bg-red-50 px-4 py-3 text-sm text-meet-red">
            {{ errorMessage }}
          </p>
        </div>

        <div class="mt-6 border-t border-meet-line pt-5">
          <p class="mb-3 text-sm font-semibold text-meet-ink">JSON meeting templates</p>
          <div class="grid gap-3">
            <button
              v-for="room in seedRooms"
              :key="room.title"
              class="rounded-lg border border-meet-line p-4 text-left transition hover:border-meet-blue"
              type="button"
              @click="createMeeting(room.title)"
            >
              <span class="block font-medium text-meet-ink">{{ room.title }}</span>
              <span class="mt-1 block text-sm text-meet-muted">{{ room.description }}</span>
            </button>
          </div>
        </div>
      </div>
    </section>
  </main>
</template>

<script setup lang="ts">
import { CalendarPlus, LogIn, Video, Users } from "lucide-vue-next";
import type { PublicRoom, SeedRoom, SeedUser } from "~/types/meeting";

const config = useRuntimeConfig();
const apiBase = config.public.apiBase as string;

const displayName = ref("");
const roomCode = ref("");
const meetingTitle = ref("");
const activeRooms = ref<PublicRoom[]>([]);
const seedRooms = ref<SeedRoom[]>([]);
const seedUsers = ref<SeedUser[]>([]);
const loading = ref(false);
const errorMessage = ref("");

const suggestedNames = computed(() => seedUsers.value.map((user) => user.displayName));

async function loadBootstrap() {
  try {
    const data = await $fetch<{
      activeRooms: PublicRoom[];
      seedRooms: SeedRoom[];
      seedUsers: SeedUser[];
    }>(`${apiBase}/api/bootstrap`);

    activeRooms.value = data.activeRooms;
    seedRooms.value = data.seedRooms;
    seedUsers.value = data.seedUsers;
  } catch {
    errorMessage.value = "Backend is not reachable. Start the Express server and refresh.";
  }
}

function persistName() {
  if (import.meta.client && displayName.value.trim()) {
    localStorage.setItem("meet.displayName", displayName.value.trim());
  }
}

async function createMeeting(title?: string) {
  errorMessage.value = "";
  loading.value = true;
  try {
    persistName();
    const response = await $fetch<{ room: PublicRoom; hostToken: string }>(`${apiBase}/api/meetings`, {
      method: "POST",
      body: {
        hostName: displayName.value.trim() || "Guest",
        title: title || meetingTitle.value
      }
    });
    sessionStorage.setItem(`meet.hostToken.${response.room.id}`, response.hostToken);
    await navigateTo(`/meeting/${response.room.id}`);
  } catch {
    errorMessage.value = "Could not create the meeting.";
  } finally {
    loading.value = false;
  }
}

async function joinMeeting(code = roomCode.value) {
  const cleaned = code.trim().toLowerCase();
  if (!cleaned) {
    errorMessage.value = "Enter a meeting code.";
    return;
  }

  if (!/^[a-z]{3}-[a-z]{3}-[a-z]{3}$/.test(cleaned)) {
    errorMessage.value = "Use meeting code format uih-hhd-erb.";
    return;
  }

  errorMessage.value = "";
  loading.value = true;
  try {
    persistName();
    await $fetch(`${apiBase}/api/meetings/${cleaned}/join`, { method: "POST" });
    await navigateTo(`/meeting/${cleaned}`);
  } catch {
    errorMessage.value = "Meeting not found or expired.";
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  displayName.value = localStorage.getItem("meet.displayName") || "";
  void loadBootstrap();
});
</script>
