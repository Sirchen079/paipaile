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
const hearts = (hp: number) => '❤️'.repeat(Math.max(0, hp));
const url = computed(() => `${location.host}`);
</script>

<template>
  <div class="col" style="gap: 12px">
    <div class="card col" style="align-items: center; gap: 6px">
      <div class="muted">房间码 · 发给好友让玩家加入</div>
      <div class="code-big">{{ room.code }}</div>
      <div class="muted">{{ url }}</div>
    </div>

    <div class="card col">
      <div class="row spread">
        <div style="font-weight: 700">玩家（{{ room.players.length }}/9）</div>
        <div class="muted">{{ room.players.length < 2 ? '还差 ' + (2 - room.players.length) + ' 人开局' : '人齐了！' }}</div>
      </div>
      <div class="players">
        <div
          v-for="p in room.players" :key="p.id" class="pcard"
          :class="{ me: p.id === myId, offline: !p.connected }"
        >
          <div v-if="p.id === room.hostId" class="host">👑房主</div>
          <div class="avatar">{{ p.avatar }}</div>
          <div class="name">{{ p.name }}</div>
        </div>
      </div>
    </div>

    <div class="card col">
      <div style="font-weight: 700">本局设置 {{ isHost ? '' : '（房主设定）' }}</div>
      <div class="row spread">
        <span>每人血量</span>
        <div v-if="isHost" class="row">
          <button class="ghost" style="padding: 6px 14px" :disabled="room.config.hp <= 1" @click="emit('config', { hp: room.config.hp - 1 })">−</button>
          <b style="min-width: 34px; text-align: center; font-size: 18px">{{ room.config.hp }}</b>
          <button class="ghost" style="padding: 6px 14px" :disabled="room.config.hp >= 10" @click="emit('config', { hp: room.config.hp + 1 })">＋</button>
        </div>
        <b v-else style="font-size: 18px">{{ room.config.hp }} ❤️</b>
      </div>
      <div class="row spread">
        <span>出招倒计时</span>
        <select
          :value="room.config.pickSeconds" :disabled="!isHost"
          @change="emit('config', { pickSeconds: Number(($event.target as HTMLSelectElement).value) })"
        >
          <option v-for="s in [10, 15, 20, 30]" :key="s" :value="s">{{ s }} 秒</option>
        </select>
      </div>
      <div class="row spread">
        <span>队友误伤 <span class="muted">（组队模式生效）</span></span>
        <button class="ghost" style="padding: 6px 16px" :disabled="!isHost" @click="emit('config', { friendlyFire: !room.config.friendlyFire })">
          {{ room.config.friendlyFire ? '开启' : '关闭（默认）' }}
        </button>
      </div>
    </div>

    <button v-if="isHost" class="big" :disabled="room.players.length < 2" @click="emit('start')">
      🎉 开始游戏（{{ room.players.length < 2 ? '至少 2 人' : '大家坐稳了' }}）
    </button>
    <div v-else class="muted" style="text-align: center">等待房主开始…</div>
    <button class="ghost big" @click="emit('leave')">退出房间</button>
  </div>
</template>
