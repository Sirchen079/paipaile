<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { socket, loadProfile, saveProfile, type Profile } from './socket';
import { checkAuth } from './api';
import LoginView from './components/LoginView.vue';
import HomeView from './components/HomeView.vue';
import RoomView from './components/RoomView.vue';
import GameView from './components/GameView.vue';
import type { GameEvent } from '@shared/types';

interface PlayerPublic {
  id: string; name: string; avatar: string;
  hp: number; v: number; alive: boolean; connected: boolean; picked: boolean;
}
interface RoomState {
  code: string; hostId: string; phase: 'lobby' | 'pick' | 'show' | 'end';
  round: number; deadline: number; serverNow: number;
  config: { hp: number; pickSeconds: number; friendlyFire: boolean };
  players: PlayerPublic[];
}
interface RoundResultData { round: number; events: GameEvent[]; standings: PlayerPublic[] }
interface EndData { winners: string[]; draw: boolean; standings: PlayerPublic[] }

const view = ref<'loading' | 'login' | 'home' | 'room'>('loading');
const room = ref<RoomState | null>(null);
const results = ref<RoundResultData[]>([]);
const endData = ref<EndData | null>(null);
const clockOffset = ref(0);
const profile = ref<Profile>(loadProfile());
const toast = ref('');

let toastTimer: ReturnType<typeof setTimeout> | null = null;
function showError(msg: string) {
  toast.value = msg;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.value = ''), 2600);
}

onMounted(() => {
  socket.on('room:state', (s: RoomState) => {
    room.value = s;
    clockOffset.value = s.serverNow - Date.now();
    if (s.phase === 'lobby' && view.value === 'room' && results.value.length && !endData.value) {
      results.value = [];
    }
  });
  socket.on('game:phase', (p: { phase: string; round: number; deadline: number; serverNow: number }) => {
    clockOffset.value = p.serverNow - Date.now();
    if (p.phase === 'pick' && p.round === 1) {
      results.value = [];
      endData.value = null;
    }
  });
  socket.on('round:result', (r: RoundResultData) => {
    results.value.push(r);
  });
  socket.on('game:end', (e: EndData) => {
    endData.value = e;
  });
  socket.on('room:left', () => {
    room.value = null;
    results.value = [];
    endData.value = null;
  });
  socket.on('connect_error', (err: Error) => {
    if (err.message.includes('unauthorized')) {
      view.value = 'login';
    }
  });

  checkAuth().then((ok) => {
    if (ok) {
      view.value = 'home';
      socket.connect();
    } else {
      view.value = 'login';
    }
  });
});

function onLoggedIn() {
  view.value = 'home';
  socket.connect();
}

function enterRoom(profileIn: Profile, code?: string) {
  profile.value = profileIn;
  saveProfile(profileIn);
  const done = (r: { ok: boolean; error?: string }) => {
    if (!r.ok) showError(r.error ?? '进入房间失败');
  };
  if (code) {
    socket.emit('room:join', { code, nickname: profileIn.nickname, avatar: profileIn.avatar }, done);
  } else {
    socket.emit('room:create', { nickname: profileIn.nickname, avatar: profileIn.avatar }, done);
  }
  view.value = 'room';
}

function leaveRoom() {
  socket.emit('room:leave');
  room.value = null;
  results.value = [];
  endData.value = null;
  view.value = 'home';
}

function patchConfig(patch: Record<string, unknown>) {
  socket.emit('room:config', patch, (r: { ok: boolean; error?: string }) => {
    if (!r.ok) showError(r.error ?? '设置失败');
  });
}

function startGame() {
  socket.emit('game:start', {}, (r: { ok: boolean; error?: string }) => {
    if (!r.ok) showError(r.error ?? '开始失败');
  });
}

function submitMove(moveId: string, targetId?: string) {
  socket.emit('game:submit', { moveId, targetId }, (r: { ok: boolean; error?: string }) => {
    if (!r.ok) showError(r.error ?? '出招失败');
  });
}
</script>

<template>
  <div v-if="toast" class="overlay" style="background:rgba(10,12,24,.55);justify-content:flex-end;padding-bottom:12vh">
    <div class="card" style="max-width:90vw">{{ toast }}</div>
  </div>

  <LoginView v-if="view === 'login'" @done="onLoggedIn" />
  <HomeView v-else-if="view === 'home'" :profile="profile" @enter="enterRoom" />
  <template v-else-if="view === 'room' && room">
    <RoomView
      v-if="room.phase === 'lobby'"
      :room="room"
      :my-id="socket.id ?? ''"
      @config="patchConfig"
      @start="startGame"
      @leave="leaveRoom"
    />
    <GameView
      v-else
      :room="room"
      :my-id="socket.id ?? ''"
      :results="results"
      :end-data="endData"
      :clock-offset="clockOffset"
      @submit="submitMove"
      @start="startGame"
      @leave="leaveRoom"
    />
  </template>
</template>
