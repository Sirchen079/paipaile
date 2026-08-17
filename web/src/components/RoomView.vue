<script setup lang="ts">
import { computed } from 'vue';

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
</script>

<template>
  <div class="col" style="gap: 14px">
    <div class="card col" style="align-items: center; gap: 8px">
      <div class="brand-sub">擂 台 房 号 · 传 音 群 内 邀 战</div>
      <div class="code-big">{{ room.code }}</div>
      <div class="muted">{{ url }}</div>
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
          <div v-if="p.id === room.hostId" class="host">👑擂主</div>
          <div class="avatar">{{ p.avatar }}</div>
          <div class="name">{{ p.name }}</div>
        </div>
      </div>
    </div>

    <div class="card col">
      <div style="font-weight: 700; letter-spacing: 2px">斗法规则 {{ isHost ? '' : '（擂主所定）' }}</div>
      <div class="row spread">
        <span>每人命数</span>
        <div v-if="isHost" class="row">
          <button class="ghost" style="padding: 7px 16px" :disabled="room.config.hp <= 1" @click="emit('config', { hp: room.config.hp - 1 })">−</button>
          <b style="min-width: 34px; text-align: center; font-size: 19px; color: var(--red)">{{ room.config.hp }}</b>
          <button class="ghost" style="padding: 7px 16px" :disabled="room.config.hp >= 10" @click="emit('config', { hp: room.config.hp + 1 })">＋</button>
        </div>
        <b v-else style="font-size: 19px; color: var(--red)">{{ room.config.hp }} 命</b>
      </div>
      <div class="row spread">
        <span>出招时限</span>
        <select
          :value="room.config.pickSeconds" :disabled="!isHost"
          @change="emit('config', { pickSeconds: Number(($event.target as HTMLSelectElement).value) })"
        >
          <option v-for="s in [10, 15, 20, 30]" :key="s" :value="s">{{ s }} 秒</option>
        </select>
      </div>
      <div class="row spread">
        <span>同门误伤 <span class="muted">（组队模式生效）</span></span>
        <button class="ghost" style="padding: 7px 16px" :disabled="!isHost" @click="emit('config', { friendlyFire: !room.config.friendlyFire })">
          {{ room.config.friendlyFire ? '开' : '关（默认）' }}
        </button>
      </div>
    </div>

    <button v-if="isHost" class="big" :disabled="room.players.length < 2" @click="emit('start')">
      🔥 {{ room.players.length < 2 ? '至少 2 人方可开阵' : '开 阵 · 斗 法 开 始' }}
    </button>
    <div v-else class="muted" style="text-align: center; letter-spacing: 2px">静候擂主开阵……</div>
    <button class="ghost big" @click="emit('leave')">拂 袖 离 场</button>
  </div>
</template>
