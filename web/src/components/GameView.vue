<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { MOVES, MOVE_ORDER, COST_LABEL } from '@shared/moves';
import type { GameEvent, MoveId } from '@shared/types';
import { eventToLine, type LogLine } from '../battlelog';
import { choreograph } from '../choreo';

interface PlayerPublic {
  id: string; name: string; avatar: string;
  hp: number; v: number; alive: boolean; connected: boolean; picked: boolean;
}
interface RoomState {
  code: string; hostId: string; phase: 'lobby' | 'pick' | 'show' | 'end';
  round: number; deadline: number;
  config: { hp: number; pickSeconds: number; friendlyFire: boolean };
  players: PlayerPublic[];
}
interface RoundResultData { round: number; events: GameEvent[]; standings: PlayerPublic[] }
interface EndData { winners: string[]; draw: boolean; standings: PlayerPublic[] }

const props = defineProps<{ room: RoomState; myId: string; results: RoundResultData[]; endData: EndData | null; clockOffset: number }>();
const emit = defineEmits<{ submit: [moveId: string, targetId?: string]; start: []; leave: [] }>();

const now = ref(Date.now());
const selectedMove = ref<MoveId | null>(null);
const stageEl = ref<HTMLElement | null>(null);
let tick: ReturnType<typeof setInterval>;

onMounted(() => { tick = setInterval(() => (now.value = Date.now()), 250); });
onBeforeUnmount(() => clearInterval(tick));

const me = computed(() => props.room.players.find((p) => p.id === props.myId));
const isHost = computed(() => props.myId === props.room.hostId);
const canPick = computed(() => props.room.phase === 'pick' && !!me.value?.alive && !me.value?.picked);

const secondsLeft = computed(() => {
  const remain = props.room.deadline - (now.value + props.clockOffset);
  return Math.max(0, Math.ceil(remain / 1000));
});

const nameOf = (id: string) => props.room.players.find((p) => p.id === id)?.name ?? '?';
const hearts = (hp: number) => '❤️'.repeat(Math.max(0, hp));

const logLines = computed<LogLine[]>(() => {
  const out: LogLine[] = [];
  for (const r of props.results) {
    out.push({ text: `━━ 第 ${r.round} 回合 ━━`, cls: 'roundend' });
    for (const ev of r.events) {
      const line = eventToLine(ev, nameOf);
      if (line) out.push(line);
    }
  }
  return out;
});

watch(() => logLines.value.length, async () => {
  await nextTick();
  if (stageEl.value) stageEl.value.scrollTop = stageEl.value.scrollHeight;
});

// 触发战斗演出：有新回合结果时编排 GSAP 时间轴
watch(() => props.results.length, (len) => {
  if (len > 0) {
    const latest = props.results[len - 1];
    nextTick(() => choreograph(latest.events));
  }
});

// 新回合开始时清掉上一回合未完成的选招
watch(() => props.room.round, () => {
  selectedMove.value = null;
});

function moveGroup(cost: 0 | 1 | 2 | 3) {
  return MOVE_ORDER.filter((m) => MOVES[m].cost === cost);
}

function onMoveClick(id: MoveId) {
  if (!canPick.value) return;
  const def = MOVES[id];
  if (def.cost > (me.value?.v ?? 0)) return;
  if (!def.needsTarget) {
    emit('submit', id);
    return;
  }
  selectedMove.value = selectedMove.value === id ? null : id;
}

function onPlayerClick(p: PlayerPublic) {
  if (selectedMove.value && p.alive && p.id !== props.myId) {
    emit('submit', selectedMove.value, p.id);
    selectedMove.value = null;
  }
}

const endWinnerText = computed(() => {
  if (!props.endData) return '';
  if (props.endData.draw) return '同归于尽 · 棋逢对手';
  const names = props.endData.winners.map(nameOf).join('、');
  return `${names || '无人'} · 问鼎大道`;
});
</script>

<template>
  <div class="col" style="gap: 10px">
    <!-- 回合状态条 -->
    <div class="round-banner">
      <div class="round-label">
        {{ room.phase === 'pick' ? `第 ${room.round} 回合 · 请出招` : room.phase === 'show' ? `第 ${room.round} 回合 · 神通齐发` : '大局已定' }}
      </div>
      <div v-if="room.phase === 'pick'" class="countdown" :class="{ urgent: secondsLeft <= 5 }">{{ secondsLeft }}<span style="font-size: 16px">秒</span></div>
      <div v-else class="muted">房号 {{ room.code }}</div>
    </div>

    <!-- 同道席位 -->
    <div class="players">
      <div
        v-for="p in room.players" :key="p.id" class="pcard"
        :data-pid="p.id"
        :class="{
          dead: !p.alive,
          me: p.id === myId,
          offline: !p.connected,
          targetable: !!selectedMove && p.alive && p.id !== myId,
        }"
        @click="onPlayerClick(p)"
      >
        <div v-if="p.id === room.hostId" class="host">👑</div>
        <div v-if="room.phase === 'pick' && p.picked" class="picked">✔</div>
        <div class="avatar">{{ p.avatar }}</div>
        <div class="name">{{ p.name }}</div>
        <div class="hearts">{{ hearts(p.hp) }}</div>
        <div class="v">⚡{{ p.v }}</div>
      </div>
    </div>

    <!-- 斗法实录 -->
    <div ref="stageEl" class="stage">
      <div v-if="logLines.length === 0" class="muted" style="text-align: center; margin: auto; line-height: 1.9">
        {{ room.phase === 'pick' ? '屏息凝神，选好神通。<br/>时限一到，诸天齐发……' : '神通对冲，静观其变……' }}
      </div>
      <div v-for="(l, i) in logLines" :key="i" class="log-line" :class="l.cls">{{ l.text }}</div>
    </div>

    <!-- 神通诀 -->
    <div v-if="canPick" class="card col">
      <div v-if="selectedMove" class="row spread" style="background: rgba(255,61,94,.12); border: 1px solid rgba(255,61,94,.4); border-radius: 10px; padding: 9px 14px">
        <b style="color: var(--red); letter-spacing: 1px">【{{ MOVES[selectedMove].name }}】点上方同道头像选定目标</b>
        <button class="ghost" style="padding: 6px 14px" @click="selectedMove = null">收回</button>
      </div>
      <template v-for="cost in [0, 1, 2, 3] as const" :key="cost">
        <div class="move-group-title">{{ COST_LABEL[cost] }}</div>
        <div class="moves">
          <button
            v-for="m in moveGroup(cost)" :key="m" class="move-btn"
            :class="{ sel: selectedMove === m }"
            :disabled="MOVES[m].cost > (me?.v ?? 0)"
            @click="onMoveClick(m)"
          >
            <span class="cost" :class="`cost-${cost}`">{{ cost }}V</span>
            <div class="mname">{{ MOVES[m].name }}</div>
            <div class="mdesc">{{ MOVES[m].desc }}</div>
            <div class="mflavor" :style="{ color: MOVES[m].color }">{{ MOVES[m].flavor }}</div>
          </button>
        </div>
      </template>
    </div>
    <div v-else-if="room.phase === 'pick'" class="card" style="text-align: center">
      <b style="color: var(--green)">✔ 神通已定</b> <span class="muted">静候诸位同道亮牌…（{{ room.players.filter(p => p.alive && p.picked).length }}/{{ room.players.filter(p => p.alive).length }}）</span>
    </div>
    <div v-else-if="!me?.alive && room.phase !== 'end'" class="card muted" style="text-align: center; letter-spacing: 2px">
      ☠ 道友已陨落 · 化作看客，观诸君斗法
    </div>

    <!-- 结算遮罩 -->
    <div v-if="endData" class="overlay">
      <div class="confetti">🎊</div>
      <div class="win-title">{{ endWinnerText }}</div>
      <div class="card" style="max-width: 86vw; min-width: min(340px, 86vw)">
        <div class="muted" style="text-align: center; margin-bottom: 8px; letter-spacing: 3px">本 局 战 报</div>
        <div v-for="p in endData.standings" :key="p.id" class="row spread" style="padding: 4px 6px">
          <span>{{ p.avatar }} {{ p.name }}</span>
          <span :style="{ color: p.alive ? 'var(--green)' : 'var(--text-3)', fontWeight: 700 }">{{ p.alive ? '胜出' : `陨落于第 ${room.round} 回合` }}</span>
        </div>
      </div>
      <button v-if="isHost" class="big" style="min-width: 240px" @click="emit('start')">🔁 再 开 一 局</button>
      <div v-else class="muted" style="letter-spacing: 2px">静候擂主再开一局……</div>
      <button class="ghost" style="min-width: 240px" @click="emit('leave')">拂 袖 离 场</button>
    </div>
  </div>
</template>
