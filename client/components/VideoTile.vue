<script setup lang="ts">
import { Mic, MicOff, MonitorUp, VideoOff } from "lucide-vue-next";
import type { PublicParticipant } from "~/types/meeting";

const props = defineProps<{
  participant: PublicParticipant;
  stream?: MediaStream;
  muted?: boolean;
  local?: boolean;
}>();

const videoRef = ref<HTMLVideoElement | null>(null);
const audioRef = ref<HTMLAudioElement | null>(null);

const initials = computed(() => {
  return props.participant.displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "G";
});

function playMedia(element: HTMLMediaElement | null) {
  if (!element) {
    return;
  }

  const attempt = element.play();
  if (attempt) {
    attempt.catch(() => {
      // Browsers can delay autoplay until the join click is fully processed.
    });
  }
}

function attachStream(stream?: MediaStream) {
  if (videoRef.value && videoRef.value.srcObject !== stream) {
    videoRef.value.srcObject = stream ?? null;
    playMedia(videoRef.value);
  }

  if (audioRef.value && audioRef.value.srcObject !== stream) {
    audioRef.value.srcObject = stream ?? null;
    playMedia(audioRef.value);
  }
}

watch(() => props.stream, attachStream, { immediate: true });

onMounted(() => attachStream(props.stream));
</script>

<template>
  <article class="relative flex min-h-[180px] overflow-hidden rounded-lg bg-meet-dark text-white shadow-sm">
    <video
      v-show="stream && participant.media.video"
      ref="videoRef"
      class="h-full w-full object-cover"
      muted
      autoplay
      playsinline
    />
    <audio v-if="!local" ref="audioRef" autoplay playsinline />

    <div v-if="!stream || !participant.media.video" class="flex h-full min-h-[180px] w-full items-center justify-center">
      <div class="flex h-20 w-20 items-center justify-center rounded-full bg-slate-700 text-2xl font-semibold">
        {{ initials }}
      </div>
    </div>

    <div class="absolute left-3 top-3 flex items-center gap-2">
      <span
        v-if="local"
        class="rounded bg-white/15 px-2 py-1 text-xs font-medium backdrop-blur"
      >
        You
      </span>
      <span
        v-if="participant.media.screen"
        class="flex items-center gap-1 rounded bg-white/15 px-2 py-1 text-xs font-medium backdrop-blur"
      >
        <MonitorUp class="h-3.5 w-3.5" />
        Screen
      </span>
    </div>

    <div class="absolute bottom-0 left-0 right-0 flex items-center justify-between bg-gradient-to-t from-black/75 to-transparent p-3">
      <p class="max-w-[70%] truncate text-sm font-medium">{{ participant.displayName }}</p>
      <div class="flex items-center gap-2">
        <Mic v-if="participant.media.audio" class="h-4 w-4" />
        <MicOff v-else class="h-4 w-4 text-red-200" />
        <VideoOff v-if="!participant.media.video" class="h-4 w-4 text-red-200" />
      </div>
    </div>
  </article>
</template>
