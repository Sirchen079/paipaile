<script setup lang="ts">
import { computed, ref } from 'vue';
import { AVATARS, AVATAR_LABEL, type Profile } from '../socket';

const props = defineProps<{ profile: Profile; joining?: boolean }>();
const emit = defineEmits<{ enter: [profile: Profile, code?: string] }>();

const nickname = ref(props.profile.nickname);
const avatar = ref(props.profile.avatar);
const code = ref('');
const canGo = computed(() => nickname.value.trim().length > 0 && !props.joining);
const lastCode = localStorage.getItem('pp_last_code') || '';

function pick(a: string) { avatar.value = a; }

function create() {
  if (!canGo.value) return;
  emit('enter', { nickname: nickname.value.trim(), avatar: avatar.value });
}
function join() {
  if (!canGo.value || !/^\d{4}$/.test(code.value.trim())) return;
  emit('enter', { nickname: nickname.value.trim(), avatar: avatar.value }, code.value.trim());
}
function rejoin() {
  if (!canGo.value || !lastCode) return;
  emit('enter', { nickname: nickname.value.trim(), avatar: avatar.value }, lastCode);
}
</script>

<template>
  <div class="col" style="margin-top: 5vh; gap: 18px">
    <div style="text-align: center">
      <div class="brand-title" style="font-size: 46px">拍拍乐</div>
      <div class="brand-sub" style="margin-top: 4px">同 台 斗 法 · 胜 者 为 尊</div>
    </div>

    <div class="card col">
      <label for="nick" style="font-weight: 700; letter-spacing: 2px">道友名号</label>
      <input id="nick" v-model="nickname" maxlength="12" placeholder="报上名来（玩家认得出你）" aria-label="道友名号"
        @keydown.enter.prevent="create" />
      <div class="muted" id="fz-label">法相</div>
      <div class="avatar-grid" role="group" aria-labelledby="fz-label">
        <button
          v-for="a in AVATARS" :key="a" type="button" class="avatar-cell portrait" :class="{ on: a === avatar }"
          :aria-label="`选择法相 ${AVATAR_LABEL[a]}`" :aria-pressed="a === avatar"
          @click="pick(a)"
        >
          <img :src="`/avatars/${a}.svg`" :alt="AVATAR_LABEL[a]" />
        </button>
      </div>
    </div>

    <button class="big" :disabled="!canGo" @click="create">{{ joining ? '正 在 入 座 ……' : '开 坛 立 擂' }}</button>

    <div class="card col">
      <label for="room-code" style="font-weight: 700; letter-spacing: 2px">登门挑战</label>
      <div class="row">
        <input id="room-code" v-model="code" inputmode="numeric" maxlength="4" placeholder="四位房号"
          style="letter-spacing: 4px; font-weight: 700" aria-label="四位房号" @keydown.enter.prevent="join" />
        <button style="white-space: nowrap" :disabled="!canGo || !/^\d{4}$/.test(code.trim())" @click="join">入 阵</button>
      </div>
      <button v-if="lastCode && !/^\d{4}$/.test(code.trim())" class="ghost rejoin-chip" :disabled="joining" @click="rejoin">
        断线重回 · 房号 {{ lastCode }}
      </button>
    </div>

    <div class="muted" style="text-align: center; line-height: 1.8">
      诸天齐出招，一回合定生死。<br />
      V 是法力，爆V 聚气；神通相生相克，世间无无敌之术。
    </div>
  </div>
</template>
