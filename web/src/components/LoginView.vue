<script setup lang="ts">
import { ref } from 'vue';
import { login, type Role } from '../api';

const emit = defineEmits<{ done: [role: Role] }>();
const password = ref('');
const error = ref('');
const busy = ref(false);

async function submit() {
  if (!password.value || busy.value) return;
  busy.value = true;
  error.value = '';
  const result = await login(password.value);
  busy.value = false;
  if ('error' in result) error.value = result.error;
  else emit('done', result.role);
}
</script>

<template>
  <div class="login-wrap">
    <div class="login-logo brand-title">拍拍乐</div>
    <div class="brand-sub">大 能 斗 法 · 同 台 问 鼎</div>
    <form class="col" style="width: min(340px, 86vw); margin-top: 8px" @submit.prevent="submit">
      <label for="gate-pw" class="visually-hidden">通行密令</label>
      <input id="gate-pw" v-model="password" type="password" placeholder="天地玄门 · 请输入通行密令" autocomplete="current-password" autofocus />
      <button class="big" :disabled="busy || !password">{{ busy ? '开 门 中 …' : '开 门 问 道' }}</button>
      <div v-if="error" style="color: var(--seal); text-align: center; font-size: 14px">{{ error }}</div>
    </form>
    <div class="login-hint">此地仅向持令同道开放</div>
  </div>
</template>
