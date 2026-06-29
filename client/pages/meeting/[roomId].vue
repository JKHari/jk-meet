<script setup lang="ts">
import {
  Copy,
  LogOut,
  MessageSquare,
  Mic,
  MicOff,
  MonitorUp,
  PanelRight,
  Send,
  Users,
  Video,
  VideoOff
} from "lucide-vue-next";
import { io, type Socket } from "socket.io-client";
import type { ChatMessage, MediaState, PublicParticipant, PublicPendingParticipant, PublicRoom } from "~/types/meeting";

const route = useRoute();
const config = useRuntimeConfig();
const apiBase = config.public.apiBase as string;
const roomId = computed(() => String(route.params.roomId));

const room = ref<PublicRoom | null>(null);
const participants = ref<PublicParticipant[]>([]);
const pendingParticipants = ref<PublicPendingParticipant[]>([]);
const messages = ref<ChatMessage[]>([]);
const localStream = ref<MediaStream | undefined>();
const remoteStreams = reactive<Record<string, MediaStream>>({});
const socket = shallowRef<Socket | null>(null);
const peerConnections = new Map<string, RTCPeerConnection>();
const peerVideoSenders = new Map<string, RTCRtpSender>();
const peerAudioSenders = new Map<string, RTCRtpSender>();

const displayName = ref("Guest");
const hostToken = ref("");
const selfId = ref("");
const joined = ref(false);
const waitingForApproval = ref(false);
const connecting = ref(false);
const errorMessage = ref("");
const chatBody = ref("");
const sidePanel = ref<"chat" | "people">("chat");
const panelOpen = ref(true);
const copied = ref(false);
const cameraTrack = shallowRef<MediaStreamTrack | null>(null);
const screenAudioTrack = shallowRef<MediaStreamTrack | null>(null);

const mediaState = reactive<MediaState>({
  audio: true,
  video: true,
  screen: false
});

const selfParticipant = computed<PublicParticipant>(() => ({
  id: selfId.value || "local-preview",
  socketId: selfId.value || "local-preview",
  displayName: displayName.value,
  joinedAt: Date.now(),
  media: { ...mediaState }
}));

const remoteParticipants = computed(() => participants.value.filter((participant) => participant.id !== selfId.value));
const isHost = computed(() => Boolean(selfId.value && room.value?.hostId === selfId.value));
const hasHostToken = computed(() => Boolean(hostToken.value));

const gridClass = computed(() => {
  const count = remoteParticipants.value.length + 1;
  if (count <= 1) return "grid-cols-1";
  if (count === 2) return "grid-cols-1 lg:grid-cols-2";
  if (count <= 4) return "grid-cols-1 sm:grid-cols-2";
  return "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3";
});

async function loadRoom() {
  const response = await $fetch<{
    room: PublicRoom;
    participants: PublicParticipant[];
    pendingParticipants: PublicPendingParticipant[];
    messages: ChatMessage[];
  }>(`${apiBase}/api/meetings/${roomId.value}`);

  room.value = response.room;
  participants.value = response.participants;
  pendingParticipants.value = response.pendingParticipants;
  messages.value = response.messages;
}

async function startPreview() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    });
    localStream.value = stream;
    cameraTrack.value = stream.getVideoTracks()[0] ?? null;
    mediaState.audio = stream.getAudioTracks().some((track) => track.enabled);
    mediaState.video = stream.getVideoTracks().some((track) => track.enabled);
  } catch {
    localStream.value = new MediaStream();
    mediaState.audio = false;
    mediaState.video = false;
    errorMessage.value = "Camera or microphone permission is blocked. You can still join without media.";
  }
}

function upsertParticipant(participant: PublicParticipant) {
  const index = participants.value.findIndex((item) => item.id === participant.id);
  if (index >= 0) {
    participants.value[index] = participant;
  } else {
    participants.value.push(participant);
  }
}

function removeParticipant(participantId: string) {
  participants.value = participants.value.filter((participant) => participant.id !== participantId);
  const pc = peerConnections.get(participantId);
  pc?.close();
  peerConnections.delete(participantId);
  peerVideoSenders.delete(participantId);
  peerAudioSenders.delete(participantId);
  delete remoteStreams[participantId];
}

function setRemoteTrack(peerId: string, track: MediaStreamTrack) {
  const stream = remoteStreams[peerId] ?? new MediaStream();
  if (track.kind === "video") {
    for (const existingTrack of stream.getVideoTracks()) {
      stream.removeTrack(existingTrack);
    }
  } else if (stream.getTracks().some((existingTrack) => existingTrack.id === track.id)) {
    return;
  }
  stream.addTrack(track);
  remoteStreams[peerId] = new MediaStream(stream.getTracks());
}

function getPeerConnection(peerId: string) {
  const existing = peerConnections.get(peerId);
  if (existing) {
    return existing;
  }

  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  });

  localStream.value?.getTracks().forEach((track) => {
    const sender = pc.addTrack(track, localStream.value as MediaStream);
    if (track.kind === "video") {
      peerVideoSenders.set(peerId, sender);
    }
    if (track.kind === "audio") {
      peerAudioSenders.set(peerId, sender);
    }
  });

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.value?.emit("ice-candidate", {
        to: peerId,
        candidate: event.candidate.toJSON()
      });
    }
  };

  pc.ontrack = (event) => {
    setRemoteTrack(peerId, event.track);
  };

  pc.onconnectionstatechange = () => {
    if (["failed", "closed", "disconnected"].includes(pc.connectionState)) {
      delete remoteStreams[peerId];
    }
  };

  peerConnections.set(peerId, pc);
  return pc;
}

function refreshLocalStream() {
  const audioTracks = localStream.value?.getAudioTracks() ?? [];
  const videoTracks = localStream.value?.getVideoTracks() ?? [];
  localStream.value = new MediaStream([...audioTracks, ...videoTracks]);
}

async function createOffer(peerId: string) {
  const pc = getPeerConnection(peerId);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.value?.emit("offer", { to: peerId, description: offer });
}

async function renegotiatePeers() {
  await Promise.all([...peerConnections.keys()].map((peerId) => createOffer(peerId)));
}

function emitMediaState() {
  socket.value?.emit("media-state-changed", { ...mediaState });
}

async function joinMeeting() {
  if (connecting.value || joined.value || waitingForApproval.value) {
    return;
  }

  connecting.value = true;
  errorMessage.value = "";

  const nextSocket = io(apiBase, {
    transports: ["websocket"]
  });

  socket.value = nextSocket;

  nextSocket.on("connect", () => {
    nextSocket.emit(
      "request-join",
      {
        roomId: roomId.value,
        displayName: displayName.value,
        media: { ...mediaState },
        hostToken: hostToken.value || undefined
      },
      (response: {
        ok: boolean;
        status: "approved" | "waiting";
        message?: string;
        selfId: string;
        room: PublicRoom;
        participants: PublicParticipant[];
        pendingParticipants: PublicPendingParticipant[];
        messages: ChatMessage[];
      }) => {
        if (!response.ok) {
          errorMessage.value = response.message || "Unable to join meeting.";
          connecting.value = false;
          nextSocket.disconnect();
          return;
        }

        room.value = response.room;
        if (response.status === "waiting") {
          waitingForApproval.value = true;
          connecting.value = false;
          return;
        }

        selfId.value = response.selfId;
        participants.value = response.participants;
        pendingParticipants.value = response.pendingParticipants;
        messages.value = response.messages;
        joined.value = true;
        waitingForApproval.value = false;
        connecting.value = false;
      }
    );
  });

  nextSocket.on(
    "join-approved",
    (response: {
      selfId: string;
      room: PublicRoom;
      participants: PublicParticipant[];
      pendingParticipants: PublicPendingParticipant[];
      messages: ChatMessage[];
    }) => {
      selfId.value = response.selfId;
      room.value = response.room;
      participants.value = response.participants;
      pendingParticipants.value = response.pendingParticipants;
      messages.value = response.messages;
      joined.value = true;
      waitingForApproval.value = false;
      connecting.value = false;
    }
  );

  nextSocket.on("join-denied", ({ message }: { message: string }) => {
    waitingForApproval.value = false;
    connecting.value = false;
    errorMessage.value = message;
    nextSocket.disconnect();
  });

  nextSocket.on("join-requested", ({ pendingParticipant }: { pendingParticipant: PublicPendingParticipant }) => {
    const index = pendingParticipants.value.findIndex((participant) => participant.id === pendingParticipant.id);
    if (index >= 0) {
      pendingParticipants.value[index] = pendingParticipant;
    } else {
      pendingParticipants.value.push(pendingParticipant);
    }
  });

  nextSocket.on(
    "pending-participant-removed",
    ({
      pendingId,
      pendingParticipants: nextPendingParticipants,
      room: nextRoom
    }: {
      pendingId: string;
      pendingParticipants: PublicPendingParticipant[];
      room: PublicRoom;
    }) => {
      room.value = nextRoom;
      pendingParticipants.value = nextPendingParticipants.filter((participant) => participant.id !== pendingId);
    }
  );

  nextSocket.on("host-changed", ({ room: nextRoom }: { room: PublicRoom }) => {
    room.value = nextRoom;
  });

  nextSocket.on("participant-joined", async ({ participant }: { participant: PublicParticipant }) => {
    upsertParticipant(participant);
    await createOffer(participant.id);
  });

  nextSocket.on("participant-left", ({ participantId }: { participantId: string }) => {
    removeParticipant(participantId);
  });

  nextSocket.on("media-state-changed", ({ participantId, media }: { participantId: string; media: MediaState }) => {
    participants.value = participants.value.map((participant) =>
      participant.id === participantId ? { ...participant, media } : participant
    );
  });

  nextSocket.on("chat-message", (message: ChatMessage) => {
    messages.value.push(message);
  });

  nextSocket.on("offer", async ({ from, description }: { from: string; description: RTCSessionDescriptionInit }) => {
    const pc = getPeerConnection(from);
    await pc.setRemoteDescription(description);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    nextSocket.emit("answer", { to: from, description: answer });
  });

  nextSocket.on("answer", async ({ from, description }: { from: string; description: RTCSessionDescriptionInit }) => {
    const pc = getPeerConnection(from);
    await pc.setRemoteDescription(description);
  });

  nextSocket.on("ice-candidate", async ({ from, candidate }: { from: string; candidate: RTCIceCandidateInit }) => {
    const pc = getPeerConnection(from);
    await pc.addIceCandidate(candidate);
  });

  nextSocket.on("connect_error", () => {
    connecting.value = false;
    errorMessage.value = "Signaling server is not reachable.";
  });
}

function approveJoin(pendingId: string) {
  socket.value?.emit("approve-join", { roomId: roomId.value, pendingId });
}

function denyJoin(pendingId: string) {
  socket.value?.emit("deny-join", { roomId: roomId.value, pendingId });
}

function toggleAudio() {
  mediaState.audio = !mediaState.audio;
  localStream.value?.getAudioTracks().forEach((track) => {
    track.enabled = mediaState.audio;
  });
  emitMediaState();
}

function toggleVideo() {
  mediaState.video = !mediaState.video;
  localStream.value?.getVideoTracks().forEach((track) => {
    track.enabled = mediaState.video;
  });
  emitMediaState();
}

async function replaceOutgoingVideo(track: MediaStreamTrack | null, renegotiate = true) {
  for (const [peerId, pc] of peerConnections) {
    let sender = peerVideoSenders.get(peerId) ?? pc.getSenders().find((item) => item.track?.kind === "video");
    if (!sender && track && localStream.value) {
      sender = pc.addTrack(track, localStream.value);
    } else if (sender) {
      await sender.replaceTrack(track);
    }

    if (sender) {
      peerVideoSenders.set(peerId, sender);
    }
  }

  if (renegotiate) {
    await renegotiatePeers();
  }
}

async function addOutgoingTrack(track: MediaStreamTrack, renegotiate = true) {
  for (const [peerId, pc] of peerConnections) {
    const sender = pc.addTrack(track, localStream.value as MediaStream);
    if (track.kind === "audio") {
      peerAudioSenders.set(peerId, sender);
    }
    if (track.kind === "video") {
      peerVideoSenders.set(peerId, sender);
    }
  }
  if (renegotiate) {
    await renegotiatePeers();
  }
}

async function removeOutgoingTrack(track: MediaStreamTrack, renegotiate = true) {
  for (const [peerId, pc] of peerConnections) {
    const sender = pc.getSenders().find((item) => item.track === track);
    if (sender) {
      pc.removeTrack(sender);
      if (track.kind === "audio") {
        peerAudioSenders.delete(peerId);
      }
      if (track.kind === "video") {
        peerVideoSenders.delete(peerId);
      }
    }
  }
  if (renegotiate) {
    await renegotiatePeers();
  }
}

async function startScreenShare() {
  if (mediaState.screen) {
    return;
  }

  try {
    const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    const screenTrack = screenStream.getVideoTracks()[0];
    const shareAudioTrack = screenStream.getAudioTracks()[0] ?? null;
    if (!screenTrack) {
      return;
    }

    const currentVideo = localStream.value?.getVideoTracks()[0];
    if (currentVideo) {
      localStream.value?.removeTrack(currentVideo);
    }
    localStream.value?.addTrack(screenTrack);

    if (shareAudioTrack) {
      screenAudioTrack.value = shareAudioTrack;
      localStream.value?.addTrack(shareAudioTrack);
      await addOutgoingTrack(shareAudioTrack, false);
      shareAudioTrack.onended = async () => {
        if (screenAudioTrack.value === shareAudioTrack) {
          localStream.value?.removeTrack(shareAudioTrack);
          await removeOutgoingTrack(shareAudioTrack);
          screenAudioTrack.value = null;
          refreshLocalStream();
        }
      };
    }

    refreshLocalStream();
    await replaceOutgoingVideo(screenTrack, false);
    await renegotiatePeers();
    mediaState.screen = true;
    mediaState.video = true;
    emitMediaState();

    screenTrack.onended = async () => {
      localStream.value?.removeTrack(screenTrack);
      if (screenAudioTrack.value) {
        const track = screenAudioTrack.value;
        localStream.value?.removeTrack(track);
        await removeOutgoingTrack(track, false);
        track.stop();
        screenAudioTrack.value = null;
      }

      if (cameraTrack.value) {
        localStream.value?.addTrack(cameraTrack.value);
        await replaceOutgoingVideo(cameraTrack.value, false);
        mediaState.video = cameraTrack.value.enabled;
      } else {
        await replaceOutgoingVideo(null, false);
        mediaState.video = false;
      }

      refreshLocalStream();
      await renegotiatePeers();
      mediaState.screen = false;
      emitMediaState();
    };
  } catch {
    errorMessage.value = "Screen share was cancelled or blocked.";
  }
}

async function sendMessage() {
  const body = chatBody.value.trim();
  if (!body || !joined.value) {
    return;
  }

  socket.value?.emit("chat-message", { roomId: roomId.value, body });
  chatBody.value = "";
}

async function copyLink() {
  await navigator.clipboard.writeText(window.location.href);
  copied.value = true;
  setTimeout(() => {
    copied.value = false;
  }, 1500);
}

async function leaveCall() {
  socket.value?.disconnect();
  for (const pc of peerConnections.values()) {
    pc.close();
  }
  peerConnections.clear();
  peerVideoSenders.clear();
  peerAudioSenders.clear();
  localStream.value?.getTracks().forEach((track) => track.stop());
  await navigateTo("/");
}

onMounted(async () => {
  displayName.value = localStorage.getItem("meet.displayName") || "Guest";
  hostToken.value = sessionStorage.getItem(`meet.hostToken.${roomId.value}`) || "";
  localStorage.setItem("meet.displayName", displayName.value);

  try {
    await Promise.all([loadRoom(), startPreview()]);
  } catch {
    errorMessage.value = "Meeting not found or expired.";
  }
});

onBeforeUnmount(() => {
  socket.value?.disconnect();
  for (const pc of peerConnections.values()) {
    pc.close();
  }
  peerVideoSenders.clear();
  peerAudioSenders.clear();
  localStream.value?.getTracks().forEach((track) => track.stop());
});
</script>

<template>
  <main class="flex min-h-screen flex-col bg-slate-950 text-white">
    <header class="flex h-16 items-center justify-between border-b border-white/10 px-4">
      <div class="min-w-0">
        <p class="truncate text-sm font-semibold">{{ room?.title || "Meeting" }}</p>
        <p class="text-xs text-slate-400">{{ roomId }}</p>
      </div>

      <div class="flex items-center gap-2">
        <button
          class="flex h-10 items-center gap-2 rounded-lg border border-white/10 px-3 text-sm transition hover:bg-white/10"
          type="button"
          @click="copyLink"
        >
          <Copy class="h-4 w-4" />
          <span class="hidden sm:inline">{{ copied ? "Copied" : "Copy link" }}</span>
        </button>
        <button
          class="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 transition hover:bg-white/10"
          type="button"
          @click="panelOpen = !panelOpen"
        >
          <PanelRight class="h-5 w-5" />
        </button>
      </div>
    </header>

    <section v-if="!joined" class="mx-auto grid w-full max-w-6xl flex-1 grid-cols-1 gap-6 px-5 py-8 lg:grid-cols-[1fr_360px] lg:items-center">
      <VideoTile :participant="selfParticipant" :stream="localStream" local muted />

      <aside class="rounded-lg border border-white/10 bg-white p-5 text-meet-ink shadow-soft">
        <div v-if="waitingForApproval">
          <h1 class="text-2xl font-semibold">Waiting to be admitted</h1>
          <p class="mt-2 text-sm leading-6 text-meet-muted">
            The host has been notified. You will enter the meeting when they admit you.
          </p>
          <div class="mt-6 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-meet-blue">
            {{ displayName }} wants to join {{ room?.title || "this meeting" }}.
          </div>
          <button
            class="mt-5 h-12 w-full rounded-lg border border-meet-line font-medium text-meet-ink transition hover:border-meet-red hover:text-meet-red"
            type="button"
            @click="leaveCall"
          >
            Cancel request
          </button>
        </div>

        <div v-else>
          <h1 class="text-2xl font-semibold">{{ hasHostToken ? "Ready to start?" : "Ready to join?" }}</h1>
          <p class="mt-2 text-sm leading-6 text-meet-muted">
            Preview your camera and microphone before {{ hasHostToken ? "starting" : "entering" }} the room.
          </p>

          <div class="mt-5 flex gap-3">
            <button
              class="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-meet-line text-sm font-medium transition hover:border-meet-blue"
              type="button"
              @click="toggleAudio"
            >
              <Mic v-if="mediaState.audio" class="h-4 w-4" />
              <MicOff v-else class="h-4 w-4" />
              Mic
            </button>
            <button
              class="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-meet-line text-sm font-medium transition hover:border-meet-blue"
              type="button"
              @click="toggleVideo"
            >
              <Video v-if="mediaState.video" class="h-4 w-4" />
              <VideoOff v-else class="h-4 w-4" />
              Camera
            </button>
          </div>

          <button
            class="mt-5 h-12 w-full rounded-lg bg-meet-blue font-medium text-white transition hover:bg-blue-700 disabled:opacity-60"
            :disabled="connecting"
            type="button"
            @click="joinMeeting"
          >
            {{ connecting ? (hasHostToken ? "Starting..." : "Requesting...") : (hasHostToken ? "Start meeting" : "Ask to join") }}
          </button>
        </div>

        <p v-if="errorMessage" class="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-meet-red">
          {{ errorMessage }}
        </p>
      </aside>
    </section>

    <section v-else class="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[1fr_auto]">
      <div class="flex min-h-0 flex-col">
        <div
          v-if="isHost && pendingParticipants.length"
          class="fixed right-4 top-20 z-30 w-[min(360px,calc(100vw-2rem))] space-y-3 rounded-lg border border-meet-line bg-white p-4 text-meet-ink shadow-soft"
        >
          <p class="text-sm font-semibold">Waiting to join</p>
          <div v-for="pending in pendingParticipants" :key="pending.id" class="rounded-lg border border-meet-line p-3">
            <p class="truncate text-sm font-medium">{{ pending.displayName }} wants to join</p>
            <p class="mt-1 text-xs text-meet-muted">
              Requested {{ new Date(pending.requestedAt).toLocaleTimeString() }}
            </p>
            <div class="mt-3 grid grid-cols-2 gap-2">
              <button
                class="h-9 rounded-lg bg-meet-blue text-sm font-medium text-white transition hover:bg-blue-700"
                type="button"
                @click="approveJoin(pending.id)"
              >
                Admit
              </button>
              <button
                class="h-9 rounded-lg border border-meet-line text-sm font-medium text-meet-ink transition hover:border-meet-red hover:text-meet-red"
                type="button"
                @click="denyJoin(pending.id)"
              >
                Deny
              </button>
            </div>
          </div>
        </div>

        <div class="min-h-0 flex-1 overflow-auto p-4">
          <div class="grid h-full min-h-[420px] gap-4" :class="gridClass">
            <VideoTile :participant="selfParticipant" :stream="localStream" local muted />
            <VideoTile
              v-for="participant in remoteParticipants"
              :key="participant.id"
              :participant="participant"
              :stream="remoteStreams[participant.id]"
            />
          </div>
        </div>

        <footer class="flex min-h-20 flex-wrap items-center justify-center gap-3 border-t border-white/10 px-4 py-3">
          <button
            class="flex h-12 w-12 items-center justify-center rounded-full transition"
            :class="mediaState.audio ? 'bg-white/10 hover:bg-white/15' : 'bg-meet-red hover:bg-red-700'"
            type="button"
            @click="toggleAudio"
          >
            <Mic v-if="mediaState.audio" class="h-5 w-5" />
            <MicOff v-else class="h-5 w-5" />
          </button>

          <button
            class="flex h-12 w-12 items-center justify-center rounded-full transition"
            :class="mediaState.video ? 'bg-white/10 hover:bg-white/15' : 'bg-meet-red hover:bg-red-700'"
            type="button"
            @click="toggleVideo"
          >
            <Video v-if="mediaState.video" class="h-5 w-5" />
            <VideoOff v-else class="h-5 w-5" />
          </button>

          <button
            class="flex h-12 w-12 items-center justify-center rounded-full transition"
            :class="mediaState.screen ? 'bg-meet-green' : 'bg-white/10 hover:bg-white/15'"
            type="button"
            @click="startScreenShare"
          >
            <MonitorUp class="h-5 w-5" />
          </button>

          <button
            class="flex h-12 items-center justify-center gap-2 rounded-full bg-meet-red px-5 font-medium transition hover:bg-red-700"
            type="button"
            @click="leaveCall"
          >
            <LogOut class="h-5 w-5" />
            Leave
          </button>
        </footer>
      </div>

      <aside v-if="panelOpen" class="flex max-h-[calc(100vh-4rem)] w-full flex-col border-l border-white/10 bg-white text-meet-ink lg:w-80">
        <div class="grid grid-cols-2 border-b border-meet-line p-2">
          <button
            class="flex h-10 items-center justify-center gap-2 rounded-lg text-sm font-medium"
            :class="sidePanel === 'chat' ? 'bg-blue-50 text-meet-blue' : 'text-meet-muted'"
            type="button"
            @click="sidePanel = 'chat'"
          >
            <MessageSquare class="h-4 w-4" />
            Chat
          </button>
          <button
            class="flex h-10 items-center justify-center gap-2 rounded-lg text-sm font-medium"
            :class="sidePanel === 'people' ? 'bg-blue-50 text-meet-blue' : 'text-meet-muted'"
            type="button"
            @click="sidePanel = 'people'"
          >
            <Users class="h-4 w-4" />
            People
          </button>
        </div>

        <div v-if="sidePanel === 'chat'" class="flex min-h-0 flex-1 flex-col">
          <div class="min-h-0 flex-1 space-y-3 overflow-auto p-4">
            <p v-if="messages.length === 0" class="text-sm text-meet-muted">No messages yet.</p>
            <div v-for="message in messages" :key="message.id" class="rounded-lg bg-slate-100 p-3">
              <div class="mb-1 flex items-center justify-between gap-2">
                <p class="truncate text-sm font-medium">{{ message.senderName }}</p>
                <time class="text-xs text-meet-muted">{{ new Date(message.createdAt).toLocaleTimeString() }}</time>
              </div>
              <p class="break-words text-sm leading-5">{{ message.body }}</p>
            </div>
          </div>

          <form class="flex gap-2 border-t border-meet-line p-3" @submit.prevent="sendMessage">
            <input
              v-model="chatBody"
              class="h-11 min-w-0 flex-1 rounded-lg border border-meet-line px-3 outline-none focus:border-meet-blue"
              placeholder="Send a message"
              type="text"
            />
            <button class="flex h-11 w-11 items-center justify-center rounded-lg bg-meet-blue text-white" type="submit">
              <Send class="h-4 w-4" />
            </button>
          </form>
        </div>

        <div v-else class="min-h-0 flex-1 overflow-auto p-4">
          <p class="mb-3 text-sm font-semibold">{{ participants.length }} participants</p>
          <div class="space-y-2">
            <div
              v-for="participant in participants"
              :key="participant.id"
              class="flex items-center justify-between gap-3 rounded-lg border border-meet-line p-3"
            >
              <div class="min-w-0">
                <p class="truncate text-sm font-medium">{{ participant.displayName }}</p>
                <p class="text-xs text-meet-muted">{{ participant.id === selfId ? "You" : "Guest" }}</p>
              </div>
              <div class="flex shrink-0 gap-2 text-meet-muted">
                <Mic v-if="participant.media.audio" class="h-4 w-4" />
                <MicOff v-else class="h-4 w-4 text-meet-red" />
                <Video v-if="participant.media.video" class="h-4 w-4" />
                <VideoOff v-else class="h-4 w-4 text-meet-red" />
              </div>
            </div>
          </div>

          <div v-if="isHost && pendingParticipants.length" class="mt-5 border-t border-meet-line pt-4">
            <p class="mb-3 text-sm font-semibold">{{ pendingParticipants.length }} waiting</p>
            <div class="space-y-2">
              <div
                v-for="pending in pendingParticipants"
                :key="pending.id"
                class="rounded-lg border border-meet-line p-3"
              >
                <p class="truncate text-sm font-medium">{{ pending.displayName }}</p>
                <div class="mt-3 grid grid-cols-2 gap-2">
                  <button class="h-9 rounded-lg bg-meet-blue text-sm font-medium text-white" type="button" @click="approveJoin(pending.id)">
                    Admit
                  </button>
                  <button class="h-9 rounded-lg border border-meet-line text-sm font-medium" type="button" @click="denyJoin(pending.id)">
                    Deny
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </section>
  </main>
</template>
