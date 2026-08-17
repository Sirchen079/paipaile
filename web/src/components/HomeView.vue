<script setup lang="ts">
import { computed, ref } from 'vue';
import { AVATARS, type Profile } from '../socket';

const props = defineProps<{ profile: Profile }>();
const emit = defineEmits<{ enter: [profile: Profile, code?: string] }>();

const nickname = ref(props.profile.nickname);
const avatar = ref(props.profile.avatar);
const code = ref('');
const canGo = computed(() => nickname.value.trim().length > 0);

function pick(a: string) { avatar.value = a; }

function create() {
  if (!canGo.value) return;
  emit('enter', { nickname: nickname.value.trim(), avatar: avatar.value });
}
function join() {
  if (!canGo.value || !/^\d{4}$/.test(code.value.trim())) return;
  emit('enter', { nickname: nickname.value.trim(), avatar: avatar.value }, code.value.trim());
}
</script>

<template>
  <div class="col" style="margin-top: 8vh; gap: 16px">
    <div class="title" style="text-align: center">🎮 拍拍乐</div>

    <div class="card col">
      <div style="font-weight: 700">我的形象</div>
      <input v-model="nickname" maxlength="12" placeholder="游戏昵称（玩家认得出你）" />
      <div class="avatar-grid">
        <div
          v-for="a in AVATARS" :key="a" class="avatar-cell" :class="{ on: a === avatar }"
          @click="pick(a)"
        >{{ a }}</div>
      </div>
    </div>

    <button class="big" :disabled="!canGo" @click="create">⚔️ 创建房间</button>

    <div class="card col">
      <div style="font-weight: 700">加入房间</div>
      <div class="row">
        <input v-model="code" inputmode="numeric" maxlength="4" placeholder="4 位房间码" />
        <button :disabled="!canGo || !/^\d{4}$/.test(code.trim())" @click="join">加入</button>
      </div>
    </div>

    <div class="muted" style="text-align: center">
      规则：所有人同时出招，一起结算。<br />V 是能量，爆V 可充能；招式之间循环克制，没有无敌招。
    </div>
  </div>
</template>
