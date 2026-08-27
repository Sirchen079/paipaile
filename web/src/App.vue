<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { socket, loadProfile, saveProfile, type Profile } from './socket';
import { checkAuth } from './api';
import { sfx } from './sfx';
import { MOVES } from '@shared/moves';
import LoginView from './components/LoginView.vue';
import HomeView from './components/HomeView.vue';
import RoomView from './components/RoomView.vue';
import GameView from './components/GameView.vue';
import ArenaDemo from './components/ArenaDemo.vue';
import type { GameEvent } from '@shared/types';
import type { Role } from './api';

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

const view = ref<'loading' | 'login' | 'home' | 'room' | 'arena'>('loading');
const room = ref<RoomState | null>(null);
const results = ref<RoundResultData[]>([]);
const endData = ref<EndData | null>(null);
const clockOffset = ref(0);
const profile = ref<Profile>(loadProfile());
const toast = ref('');
const joining = ref(false);

let toastTimer: ReturnType<typeof setTimeout> | null = null;
function showError(msg: string) {
  toast.value = msg;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.value = ''), 2600);
}

/** 音效引擎需在首次用户手势后才能出声（浏览器自动播放策略） */
function unlockSfx() { sfx.ensure(); }

/** 14 招水墨特效（~5MB）空闲预载：登录成功即后台拉取，首轮亮牌不闪图 */
function preloadInkFx() {
  const start = () => {
    for (const m of Object.keys(MOVES)) {
      const img = new Image();
      img.src = `/inkfx/${m}.webp`;
      img.decode().catch(() => {});
    }
  };
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
  if (w.requestIdleCallback) w.requestIdleCallback(start, { timeout: 5000 });
  else setTimeout(start, 1800);
}

onMounted(() => {
  document.addEventListener('pointerdown', unlockSfx, { once: true });

  socket.on('room:state', (s: RoomState) => {
    room.value = s;
    clockOffset.value = s.serverNow - Date.now();
    // 重连/中途入房恰好落在终局阶段时，game:end 已错过收不到——
    // 从当前战况推导兜底战报（存活者即胜者），否则玩家被困在无按钮的死局桌面
    if (s.phase === 'end' && !endData.value) {
      const winners = s.players.filter((p) => p.alive).map((p) => p.id);
      endData.value = { winners, draw: winners.length === 0, standings: s.players };
    }
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
  // 断线：房间态立即作废（重连后由 room:state 重建），避免拿着旧房态自欺
  socket.on('disconnect', () => {
    if (view.value === 'room') room.value = null;
  });
  // 重连自动归座：对局中掉线（网络抖动/锁屏）无需手动找房号
  socket.on('connect', () => {
    const last = localStorage.getItem('pp_last_code');
    if (view.value === 'room' && !room.value && last && profile.value.nickname) {
      socket.emit('room:join',
        { code: last, nickname: profile.value.nickname, avatar: profile.value.avatar },
        (r: { ok: boolean }) => {
          if (!r?.ok) {
            localStorage.removeItem('pp_last_code');   // 房间已散，别再自动撞墙
            if (view.value === 'room') view.value = 'home';
          } else {
            results.value = [];   // 新会话开卷：上一局的战报缓存不作数（防旧死亡回合污染终局表）
            if (room.value?.phase !== 'end') endData.value = null;
          }
        });
    }
  });
  socket.on('connect_error', (err: Error) => {
    if (err.message.includes('unauthorized')) {
      view.value = 'login';
    }
  });

  checkAuth().then((role) => {
    if (role === 'admin') view.value = 'arena';
    else if (role === 'player') {
      view.value = 'home';
      socket.connect();
      preloadInkFx();
    } else {
      view.value = 'login';
    }
  });
});

onUnmounted(() => document.removeEventListener('pointerdown', unlockSfx));

function onLoggedIn(role: Role) {
  if (role === 'admin') {
    view.value = 'arena';
    return;
  }
  view.value = 'home';
  socket.connect();
}

/** 演武场是纯客户端调试页；管理员从这里下场游玩（管理员令牌同样通过 WS 握手校验） */
function enterLobby() {
  view.value = 'home';
  socket.connect();
  preloadInkFx();
}

function enterRoom(profileIn: Profile, code?: string) {
  if (joining.value) return;
  joining.value = true;
  profile.value = profileIn;
  saveProfile(profileIn);
  const done = (r: { ok: boolean; code?: string; error?: string }) => {
    joining.value = false;
    if (!r.ok) {
      showError(r.error ?? '进入房间失败');
      return;                       // 留在首页，杜绝「白屏无路可退」
    }
    if (r.code) localStorage.setItem('pp_last_code', r.code);
    results.value = [];     // 入座即新卷：清上一局的战报缓存（中途加入残局/重开局面防串档）
    // 终局房间的兜底战报由 room:state 推导（可能已先于本 ack 到达），别误清
    if (room.value?.phase !== 'end') endData.value = null;
    view.value = 'room';
  };
  if (code) {
    socket.emit('room:join', { code, nickname: profileIn.nickname, avatar: profileIn.avatar }, done);
  } else {
    socket.emit('room:create', { nickname: profileIn.nickname, avatar: profileIn.avatar }, done);
  }
}

function leaveRoom() {
  socket.emit('room:leave');
  localStorage.removeItem('pp_last_code');
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
  <div class="ambient" aria-hidden="true"></div>

  <div v-if="toast" class="toast" role="alert">{{ toast }}</div>

  <ArenaDemo v-if="view === 'arena'" />
  <button
    v-if="view === 'arena'"
    class="ghost"
    style="position: fixed; right: 18px; bottom: 18px; z-index: 99"
    @click="enterLobby"
  >返回大厅</button>
  <template v-else>
    <div v-if="view === 'loading'" class="loading-mark brand-title">拍拍乐</div>
    <LoginView v-if="view === 'login'" @done="onLoggedIn" />
    <HomeView v-else-if="view === 'home'" :profile="profile" :joining="joining" @enter="enterRoom" />
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
    <div v-else-if="view === 'room'" class="col" style="align-items: center; margin-top: 20vh; gap: 12px">
      <div class="brand-title" style="font-size: 30px">正在入座……</div>
      <button class="ghost" @click="leaveRoom">返回</button>
    </div>
  </template>
</template>
