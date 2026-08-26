<script setup lang="ts">
import { computed, ref } from 'vue';

interface PlayerPublic {
  id: string; name: string; avatar: string;
  hp: number; v: number; alive: boolean; connected: boolean; picked: boolean;
}
interface RoomState {
  code: string; hostId: string; phase: string; round: number;
  config: { hp: number; pickSeconds: number; friendlyFire: boolean };
  players: PlayerPublic[];
}
const props = defineProps<{ room: RoomState; myId: string }>();
const emit = defineEmits<{ config: [patch: Record<string, unknown>]; start: []; leave: [] }>();

const isHost = computed(() => props.myId === props.room.hostId);
const url = computed(() => `${location.host}`);

/* 一键复制房号（传音入群的主路径）。非安全上下文（http 直连 IP）无 clipboard API,降级 execCommand */
const copied = ref(false);
let copiedTimer: ReturnType<typeof setTimeout> | null = null;
async function copyCode() {
  const text = props.room.code;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    copied.value = true;
    if (copiedTimer) clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => (copied.value = false), 1600);
  } catch { /* 复制失败不阻断:用户可手动看房号 */ }
}

/* 离场二次确认（误触保护） */
const leaveArmed = ref(false);
let leaveTimer: ReturnType<typeof setTimeout> | null = null;
function onLeaveClick() {
  if (!leaveArmed.value) {
    leaveArmed.value = true;
    if (leaveTimer) clearTimeout(leaveTimer);
    leaveTimer = setTimeout(() => (leaveArmed.value = false), 2600);
    return;
  }
  emit('leave');
}
</script>

<template>
  <div class="col" style="gap: 14px">
    <div class="card col" style="align-items: center; gap: 8px">
      <div class="brand-sub">擂 台 房 号 · 传 音 群 内 邀 战</div>
      <div class="code-big">{{ room.code }}</div>
      <div class="row" style="gap: 8px">
        <span class="muted">{{ url }}</span>
        <button
          class="ghost" :class="{ on: copied }" style="padding: 5px 14px; font-size: 14px"
          :aria-label="copied ? '已复制房号' : '复制房号'" @click="copyCode"
        >{{ copied ? '已 传 音' : '复 制 房 号' }}</button>
      </div>
    </div>

    <div class="card col">
      <div class="row spread">
        <div style="font-weight: 700; letter-spacing: 2px">同道入座（{{ room.players.length }}/9）</div>
        <div class="muted">{{ room.players.length < 2 ? '尚差 ' + (2 - room.players.length) + ' 位开阵' : '众位到齐' }}</div>
      </div>
      <div class="players">
        <div
          v-for="p in room.players" :key="p.id" class="pcard"
          :class="{ me: p.id === myId, offline: !p.connected }"
        >
          <div v-if="p.id === room.hostId" class="host">擂主</div>
          <img class="portrait" :src="`/avatars/${p.avatar}.svg`" :alt="p.avatar" loading="lazy" />
          <div class="name">{{ p.name }}</div>
        </div>
      </div>
    </div>

    <div class="card col">
      <div style="font-weight: 700; letter-spacing: 2px">斗法规则 {{ isHost ? '' : '（擂主所定）' }}</div>
      <div class="row spread">
        <span>每人命数</span>
        <div v-if="isHost" class="row">
          <button class="ghost" style="padding: 7px 16px" :disabled="room.config.hp <= 1" aria-label="减少命数" @click="emit('config', { hp: room.config.hp - 1 })">−</button>
          <b style="min-width: 34px; text-align: center; font-size: 19px; color: var(--seal)">{{ room.config.hp }}</b>
          <button class="ghost" style="padding: 7px 16px" :disabled="room.config.hp >= 10" aria-label="增加命数" @click="emit('config', { hp: room.config.hp + 1 })">＋</button>
        </div>
        <b v-else style="font-size: 19px; color: var(--seal)">{{ room.config.hp }} 命</b>
      </div>
      <div class="row spread">
        <label for="pick-sec">出招时限</label>
        <select
          id="pick-sec"
          :value="room.config.pickSeconds" :disabled="!isHost"
          @change="emit('config', { pickSeconds: Number(($event.target as HTMLSelectElement).value) })"
        >
          <option v-for="s in [10, 15, 20, 30]" :key="s" :value="s">{{ s }} 秒</option>
        </select>
      </div>
      <div class="row spread">
        <span>同门误伤 <span class="muted">（组队模式生效）</span></span>
        <button v-if="isHost" class="ghost" style="padding: 7px 16px" @click="emit('config', { friendlyFire: !room.config.friendlyFire })">
          {{ room.config.friendlyFire ? '开' : '关（默认）' }}
        </button>
        <b v-else style="color: var(--ink-3)">{{ room.config.friendlyFire ? '开' : '关' }}</b>
      </div>
    </div>

    <button v-if="isHost" class="big" :disabled="room.players.length < 2" @click="emit('start')">
      {{ room.players.length < 2 ? '至 少 2 人 方 可 开 阵' : '开 阵 · 斗 法 开 始' }}
    </button>
    <div v-else class="muted" style="text-align: center; letter-spacing: 2px">静候擂主开阵……</div>
    <button class="ghost big" :class="{ danger: leaveArmed }" @click="onLeaveClick">{{ leaveArmed ? '再 点 确 认 离 场' : '拂 袖 离 场' }}</button>
  </div>
</template>
