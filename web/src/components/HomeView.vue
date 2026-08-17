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
  <div class="col" style="margin-top: 5vh; gap: 18px">
    <div style="text-align: center">
      <div class="brand-title" style="font-size: 46px">拍拍乐</div>
      <div class="brand-sub" style="margin-top: 4px">同 台 斗 法 · 胜 者 为 尊</div>
    </div>

    <div class="card col">
      <div style="font-weight: 700; letter-spacing: 2px">道友名号</div>
      <input v-model="nickname" maxlength="12" placeholder="报上名来（玩家认得出你）" />
      <div class="muted">法相</div>
      <div class="avatar-grid">
        <div
          v-for="a in AVATARS" :key="a" class="avatar-cell" :class="{ on: a === avatar }"
          @click="pick(a)"
        >{{ a }}</div>
      </div>
    </div>

    <button class="big" :disabled="!canGo" @click="create">⚔ 开 坛 立 擂</button>

    <div class="card col">
      <div style="font-weight: 700; letter-spacing: 2px">登门挑战</div>
      <div class="row">
        <input v-model="code" inputmode="numeric" maxlength="4" placeholder="四位房号" style="letter-spacing: 4px; font-weight: 700" />
        <button style="white-space: nowrap" :disabled="!canGo || !/^\d{4}$/.test(code.trim())" @click="join">入 阵</button>
      </div>
    </div>

    <div class="muted" style="text-align: center; line-height: 1.8">
      诸天齐出招，一回合定生死。<br />
      V 是法力，爆V 聚气；神通相生相克，世间无无敌之术。
    </div>
  </div>
</template>
