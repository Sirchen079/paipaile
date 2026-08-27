<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { MOVES, MOVE_ORDER, COST_LABEL } from '@shared/moves';
import { roundPlaybackMs } from '@shared/pacing';
import type { GameEvent, MoveId } from '@shared/types';
import { Arena } from '../arena';
import { sfx } from '../sfx';

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
const arenaEl = ref<HTMLElement | null>(null);
let arena: Arena | null = null;
let tick: ReturnType<typeof setInterval>;

/** 演出中：斗法场状态由事件流推进，屏蔽服务端结算后状态的即时同步（防剧透） */
const playing = ref(false);
let playTimer: ReturnType<typeof setTimeout> | null = null;
/** 令牌展示用的玩家状态（show 阶段逐事件落地，其余时间跟随服务端） */
const stagePlayers = ref<PlayerPublic[]>([...props.room.players]);

onMounted(async () => {
  tick = setInterval(() => (now.value = Date.now()), 250);
  document.addEventListener('click', onGlobalClick);
  if (arenaEl.value) {
    arena = new Arena();
    await arena.init(arenaEl.value);
    syncArena();
    arena.onSeatClick((id) => {
      if (selectedMove.value) {
        sfx.submit();
        emit('submit', selectedMove.value, id);
        selectedMove.value = null;
      }
    });
  }
});
onBeforeUnmount(() => {
  clearInterval(tick);
  if (playTimer) clearTimeout(playTimer);
  document.removeEventListener('click', onGlobalClick);
  arena?.destroy();
});

/** 全局点按音（按钮与场中令牌） */
function onGlobalClick(e: MouseEvent) {
  const t = e.target as Element | null;
  if (t?.closest('button, .itoken')) sfx.click();
}

const me = computed(() => stagePlayers.value.find((p) => p.id === props.myId));
const isHost = computed(() => props.myId === props.room.hostId);
const canPick = computed(() => props.room.phase === 'pick' && !!me.value?.alive && !me.value?.picked);

const secondsLeft = computed(() => {
  const remain = props.room.deadline - (now.value + props.clockOffset);
  return Math.max(0, Math.ceil(remain / 1000));
});

/** 出招时限剩余比例（0~100，水墨进度线的驱动值；随 250ms 心跳线性流动） */
const pctLeft = computed(() => {
  if (props.room.phase !== 'pick') return 0;
  const total = props.room.config.pickSeconds * 1000;
  return Math.max(0, Math.min(100, ((props.room.deadline - (now.value + props.clockOffset)) / total) * 100));
});

const nameOf = (id: string) => stagePlayers.value.find((p) => p.id === id)?.name ?? props.room.players.find((p) => p.id === id)?.name ?? '?';

function syncArena() {
  if (!arena) return;
  arena.setPlayers(
    stagePlayers.value.map((p) => ({
      id: p.id, name: p.name, hp: p.hp, maxHp: props.room.config.hp, v: p.v, alive: p.alive, picked: p.picked,
    })),
    props.myId,
  );
}

// 玩家状态变化 → 同步斗法场（演出中除外：按事件流走，roundEnd 后对账）
watch(() => props.room.players, () => {
  if (playing.value) return;
  stagePlayers.value = [...props.room.players];
  syncArena();
}, { deep: true });

/** 事件落地到展示状态（引擎规则：命中 -1 血；death 淘汰；vChange 直设） */
function applyEventToStage(ev: GameEvent) {
  const list = stagePlayers.value;
  const i = list.findIndex((p) => p.id === (ev.type === 'hit' ? ev.dst : ev.type === 'death' ? ev.p : ev.type === 'vChange' ? ev.p : ''));
  if (ev.type === 'hit' && i >= 0) list[i] = { ...list[i], hp: Math.max(0, list[i].hp - 1) };
  else if (ev.type === 'death' && i >= 0) list[i] = { ...list[i], alive: false };
  else if (ev.type === 'vChange' && i >= 0) list[i] = { ...list[i], v: ev.v };
  syncArena();
}

// 新回合结果 → 播放演出（状态随事件逐个揭晓）
watch(() => props.results.length, (len) => {
  if (len > 0 && arena) {
    const latest = props.results[len - 1];
    playing.value = true;
    stagePlayers.value = stagePlayers.value.map((p) => ({ ...p, picked: false }));   // 亮牌后摘掉已定珠
    syncArena();
    nextTick(() => arena!.playRound(latest.events, nameOf, applyEventToStage));
    if (playTimer) clearTimeout(playTimer);
    // 与服务端 showMs 同口径封顶 20s：大招连发超长回合时，客户端掐断尾巴对账，
    // 保证下一回合出招倒计时与所有人同步（否则本地还在播、别人已开始出招）
    const total = Math.min(20000, roundPlaybackMs(latest.events));
    playTimer = setTimeout(() => {
      playing.value = false;
      arena?.stopPlayback();                          // 掐断未播完的事件链
      stagePlayers.value = [...props.room.players];   // 对账：以服务端为准
      syncArena();
      arena?.resetRound();
    }, total);
  }
});

// 新回合开始 → 清选招 + 复位斗法场（清回合内状态）
watch(() => props.room.round, () => {
  selectedMove.value = null;
  playing.value = false;
  if (playTimer) clearTimeout(playTimer);
  stagePlayers.value = [...props.room.players];
  syncArena();
  arena?.resetRound();
});

// 阶段切换：离开出招阶段清待选目标；进入出招阶段开场鼓
watch(() => props.room.phase, (ph, old) => {
  if (ph !== 'pick') selectedMove.value = null;
  if (ph === 'pick' && old !== 'pick') sfx.drum();
});

// 倒计时最后三秒滴答
watch(secondsLeft, (s, prev) => {
  if (props.room.phase === 'pick' && s <= 3 && s < prev) sfx.tick();
});

// 招式选定 → 高亮可选目标
watch(selectedMove, (m) => {
  if (!arena) return;
  if (m && MOVES[m].needsTarget) {
    const targets = stagePlayers.value.filter((p) => p.alive && p.id !== props.myId).map((p) => p.id);
    arena.highlightTargets(targets);
  } else {
    arena.highlightTargets([]);
  }
});

function moveGroup(cost: 0 | 1 | 2 | 3) {
  return MOVE_ORDER.filter((m) => MOVES[m].cost === cost);
}

function onMoveClick(id: MoveId) {
  if (!canPick.value) return;
  const def = MOVES[id];
  if (def.cost > (me.value?.v ?? 0)) return;
  if (!def.needsTarget) {
    sfx.submit();
    emit('submit', id);
    return;
  }
  selectedMove.value = selectedMove.value === id ? null : id;
}

/* ---- 静音开关 ---- */
const muted = ref(sfx.muted);
function toggleSfx() { muted.value = sfx.toggle(); }

/* ---- 离场需二次确认（误触保护：对局中离开=弃权） ---- */
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

/** 各玩家实际阵亡回合（从历史战报推导，结算页不再全员显示终局回合） */
const deathRound = computed(() => {
  const m = new Map<string, number>();
  for (const r of props.results) {
    for (const ev of r.events) if (ev.type === 'death') m.set(ev.p, r.round);
  }
  return m;
});

const endWinnerText = computed(() => {
  if (!props.endData) return '';
  if (props.endData.draw) return '同归于尽 · 棋逢对手';
  const names = props.endData.winners.map(nameOf).join('、');
  return `${names || '无人'} · 问鼎大道`;
});

/** 胜者排面（平局不展示）：从战报取胜者法相，金框头衔「魁」 */
const winnerFaces = computed(() => {
  if (!props.endData || props.endData.draw) return [];
  const avatars = new Map(props.endData.standings.map((p) => [p.id, p.avatar]));
  return props.endData.winners.map((id) => ({ id, avatar: avatars.get(id) ?? 'jianxiu' }));
});
const avatarOf = (id: string) =>
  props.endData?.standings.find((p) => p.id === id)?.avatar ?? 'jianxiu';

/** 结算遮罩揭幕时机：终局数据到达时先让最后一回合的演出收尾（如阵亡墨渍/大爆余韵），再揭开战报 */
const showEnd = computed(() => !!props.endData && !playing.value);

// 终局音与揭幕同拍：胜者奏凯，其余送别（重连进终局桌面时不响，避免无来由的哀乐）
watch(showEnd, (on) => {
  if (!on || !props.endData) return;
  const e = props.endData;
  if (!e.draw && e.winners.includes(props.myId)) sfx.win();
  else sfx.lose();
});
</script>

<template>
  <div class="game-root">
    <!-- 左：斗法场 -->
    <div class="game-main">
      <div class="round-banner">
        <div :key="`${room.round}-${room.phase}`" class="round-label round-in">
          {{ room.phase === 'pick' ? `第 ${room.round} 回合 · 请出招` : room.phase === 'show' ? `第 ${room.round} 回合 · 神通齐发` : '大局已定' }}
        </div>
        <div v-if="room.phase === 'pick'" class="countdown" :class="{ urgent: secondsLeft <= 5 }">{{ secondsLeft }}<span style="font-size: 16px">秒</span></div>
        <div v-else class="muted">房号 {{ room.code }}</div>
        <!-- 水墨时限线：朱砂渐短，紧张感随墨退而涨 -->
        <div v-if="room.phase === 'pick'" class="deadline-track" aria-hidden="true">
          <div class="deadline-fill" :class="{ urgent: secondsLeft <= 5 }" :style="{ width: pctLeft + '%' }"></div>
        </div>
      </div>

      <div ref="arenaEl" class="game-stage" />

      <!-- 底部状态条：已出招 / 待选目标 / 观战（状态切换带呼吸式过渡） -->
      <Transition name="hint-fade" mode="out-in">
        <div v-if="canPick && selectedMove" key="targeting" class="pick-hint">
          <b>【{{ MOVES[selectedMove].name }}】</b>点场中圆点选定对手
          <button class="ghost" style="padding: 5px 14px" @click="selectedMove = null">收回</button>
        </div>
        <div v-else-if="canPick" key="picking" class="pick-hint muted">
          静候出招……（{{ stagePlayers.filter(p => p.alive && p.picked).length }}/{{ stagePlayers.filter(p => p.alive).length }} 已定）
        </div>
        <div v-else-if="room.phase === 'pick' && me?.picked" key="picked" class="pick-hint ok">神通已定 · 静候诸位同道亮牌</div>
        <div v-else-if="!me?.alive && room.phase !== 'end'" key="spectating" class="pick-hint muted">已化作看客 · 观诸君斗法</div>
        <div v-else key="revealing" class="pick-hint muted">神通齐发 · 一回合定生死</div>
      </Transition>
    </div>

    <!-- 右：技能侧栏 -->
    <aside class="game-side">
      <div class="side-head">
        <span class="brand-title" style="font-size: 24px">拍拍乐</span>
        <div class="row" style="gap: 8px">
          <button class="icon-btn" :aria-label="muted ? '开启音效' : '关闭音效'" :title="muted ? '开启音效' : '关闭音效'" @click="toggleSfx">
            <svg v-if="!muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>
            <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
          </button>
          <span class="muted">房号 {{ room.code }}</span>
        </div>
      </div>

      <div class="vbar">
        <template v-if="me">我的 V：<b class="v-num">{{ me.v }}</b><span v-if="!me.alive" class="muted">（已陨落）</span></template>
        <template v-else>V ——</template>
      </div>

      <div class="skill-scroll">
        <template v-if="canPick">
          <template v-for="cost in [0, 1, 2, 3] as const" :key="cost">
            <div class="tier">{{ COST_LABEL[cost] }}</div>
            <button
              v-for="m in moveGroup(cost)" :key="m" class="skill-btn"
              :class="{ pending: selectedMove === m, poor: MOVES[m].cost > (me?.v ?? 0) }"
              :disabled="MOVES[m].cost > (me?.v ?? 0)"
              @click="onMoveClick(m)"
            >
              <span class="sk-name">{{ MOVES[m].name }}</span>
              <span class="sk-cost">{{ MOVES[m].cost ? MOVES[m].cost + 'V' : '免费' }}</span>
              <span class="sk-desc">{{ MOVES[m].desc }}</span>
            </button>
          </template>
          <p class="tip">单体神通先点按钮、再点场中圆点选定目标。飞天/遁地/护盾状态会影响命中。</p>
        </template>
        <div v-else-if="room.phase === 'pick'" class="side-wait">神通已定<br /><span class="muted">等大家亮牌……</span></div>
        <div v-else-if="room.phase === 'end'" class="side-wait">大局已定</div>
        <div v-else class="side-wait">观战之中<br /><span class="muted">神通齐发，静待揭晓</span></div>
      </div>
    </aside>

    <!-- 结算遮罩（演出收尾后揭幕） -->
    <div v-if="endData && showEnd" class="overlay">
      <div v-if="winnerFaces.length" class="winner-row">
        <span v-for="(w, i) in winnerFaces" :key="w.id" class="winner-slot" :style="{ animationDelay: (0.1 + i * 0.14) + 's' }">
          <img class="winner-face" :src="`/avatars/${w.avatar}.svg`" alt="" />
          <span class="winner-seal">魁</span>
        </span>
      </div>
      <div class="win-title">{{ endWinnerText }}</div>
      <div class="card end-card" style="max-width: 86vw; min-width: min(340px, 86vw)">
        <div class="muted" style="text-align: center; margin-bottom: 8px; letter-spacing: 3px">本 局 战 报</div>
        <div
          v-for="(p, i) in endData.standings" :key="p.id" class="row spread end-row"
          :style="{ animationDelay: (0.15 + i * 0.09) + 's' }"
        >
          <span class="row" style="gap: 8px">
            <img class="end-face" :class="{ dead: !p.alive }" :src="`/avatars/${p.avatar}.svg`" alt="" />
            <span class="end-name" :class="{ win: p.alive }">{{ p.name }}</span>
          </span>
          <span class="end-note" :class="{ win: p.alive }">{{ p.alive ? '胜出' : deathRound.has(p.id) ? `陨落于第 ${deathRound.get(p.id)} 回合` : '中途离场' }}</span>
        </div>
      </div>
      <button v-if="isHost" class="big" style="min-width: 240px" @click="emit('start')">再 开 一 局</button>
      <div v-else class="muted" style="letter-spacing: 2px">静候擂主再开一局……</div>
      <button class="ghost" :class="{ danger: leaveArmed }" style="min-width: 240px" @click="onLeaveClick">{{ leaveArmed ? '再 点 确 认 离 场' : '拂 袖 离 场' }}</button>
    </div>
  </div>
</template>
