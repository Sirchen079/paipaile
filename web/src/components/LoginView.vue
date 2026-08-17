<script setup lang="ts">
import { ref } from 'vue';
import { login } from '../api';

const emit = defineEmits<{ done: [] }>();
const password = ref('');
const error = ref('');
const busy = ref(false);

async function submit() {
  if (!password.value || busy.value) return;
  busy.value = true;
  error.value = '';
  const err = await login(password.value);
  busy.value = false;
  if (err) error.value = err;
  else emit('done');
}
</script>

<template>
  <div class="login-wrap">
    <div class="logo">🎮 拍拍乐</div>
    <div class="muted">派对对战 · 同时出招 一决胜负</div>
    <form class="col" style="width: min(320px, 86vw)" @submit.prevent="submit">
      <input v-model="password" type="password" placeholder="输入访问密码" autofocus />
      <button class="big" :disabled="busy || !password">进入</button>
      <div v-if="error" style="color: var(--red); text-align: center; font-size: 14px">{{ error }}</div>
    </form>
  </div>
</template>
