<script setup lang="ts">
/**
 * 演武场（管理员密码登录直达）：水墨特效调试页 —— 虚拟座次入座，
 * 单招点播 + 完整回合连播，用于脱离联机时序验证/调优特效。
 */
import { onMounted, onBeforeUnmount, ref } from 'vue';
import { Arena } from '../arena';
import { MOVES, MOVE_ORDER } from '@shared/moves';
import { roundPlaybackMs } from '@shared/pacing';
import type { GameEvent, MoveId } from '@shared/types';

const arenaEl = ref<HTMLElement | null>(null);
let arena: Arena | null = null;
const playing = ref(false);
const seatCount = ref(6);

const NAMES = ['剑修', '道尊', '魔尊', '仙子', '罗汉', '妖王', '鬼王', '神将', '散人'];
const makePlayers = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`, name: NAMES[i], hp: 3, maxHp: 3, v: 9, alive: true,
  }));
let PLAYERS = makePlayers(6);
const nameOf = (id: string) => PLAYERS.find((p) => p.id === id)?.name ?? id;

function setCount(n: number) {
  seatCount.value = n;
  PLAYERS = makePlayers(n);
  arena?.setPlayers(PLAYERS, 'p1');
}

const NEEDS_TARGET: MoveId[] = ['shock', 'superShock', 'finger'];
const pending = ref<MoveId | null>(null);

onMounted(async () => {
  if (!arenaEl.value) return;
  arena = new Arena();
  await arena.init(arenaEl.value);
  arena.setPlayers(PLAYERS, 'p1');
  // 点圆点：盾类施放在所选座位（含自己）；单体攻招以所选对手为目标
  arena.onSeatClick((id) => {
    if (!pending.value) return;
    const m = pending.value;
    if (SHIELD_MOVES.includes(m)) {
      pending.value = null;
      arena?.highlightTargets([]);
      arena?.playMove(m, id);
      armStateExpiry();
    } else if (id !== 'p1') {
      pending.value = null;
      arena?.highlightTargets([]);
      arena?.playMove(m, 'p1', id, true);
    }
  });
});
onBeforeUnmount(() => arena?.destroy());
// 单招点播：单体攻招进入待选目标态；盾类可选施放对象（含对手，便于搭碎盾场景）；其余直接播
// 状态招（上天/下地/盾）单回合生效——3 秒后模拟回合结束自动清除
const SHIELD_MOVES: MoveId[] = ['shield', 'superShield'];
const STATE_MOVES: MoveId[] = ['flyUp', 'burrow'];
const AOE_MOVES: MoveId[] = ['hammerSky', 'hammerGround', 'hammerBoth', 'magicBurst', 'voidRift', 'ultimate'];
let stateTimer: ReturnType<typeof setTimeout> | null = null;
function armStateExpiry() {
  if (stateTimer) clearTimeout(stateTimer);
  stateTimer = setTimeout(() => arena?.resetRound(), 3000);
}
function clearPending() {
  pending.value = null;
  arena?.highlightTargets([]);
}
function play(m: MoveId) {  if (NEEDS_TARGET.includes(m)) {
    if (pending.value === m) {
      clearPending();
      return;
    }
    pending.value = m;
    arena?.highlightTargets(PLAYERS.filter((p) => p.id !== 'p1').map((p) => p.id));
  } else if (SHIELD_MOVES.includes(m)) {
    if (pending.value === m) {
      clearPending();
      return;
    }
    pending.value = m;
    arena?.highlightTargets(PLAYERS.map((p) => p.id));
  } else {
    pending.value = null;
    arena?.highlightTargets([]);
    arena?.playMove(m, 'p1');
    if (AOE_MOVES.includes(m)) arena?.demoResolveAoe(m, 'p1');   // AOE 招逐人结算（含碎盾/格挡）
    if (STATE_MOVES.includes(m)) armStateExpiry();
  }
}

/** 完整回合连播：覆盖全部招式 + 格挡/闪避/取消/对冲/命中/阵亡 */
const SHOWCASE: GameEvent[] = [
  { type: 'reveal', p: 'p1', move: 'charge' },
  { type: 'vChange', p: 'p1', delta: 1, v: 10 },
  { type: 'reveal', p: 'p2', move: 'shield' },
  { type: 'reveal', p: 'p3', move: 'flyUp' },
  { type: 'reveal', p: 'p4', move: 'burrow' },
  { type: 'reveal', p: 'p5', move: 'shock', target: 'p2' },
  { type: 'blocked', src: 'p5', dst: 'p2', move: 'shock', by: 'shield' },
  { type: 'reveal', p: 'p6', move: 'superShock', target: 'p2' },
  { type: 'hit', src: 'p6', dst: 'p2', move: 'superShock', lethal: false },
  { type: 'reveal', p: 'p1', move: 'hammerGround' },
  { type: 'hit', src: 'p1', dst: 'p4', move: 'hammerGround', lethal: false },
  { type: 'miss', src: 'p1', dst: 'p3', move: 'hammerGround', reason: 'flyUp' },
  { type: 'reveal', p: 'p2', move: 'superShield' },
  { type: 'reveal', p: 'p3', move: 'finger', target: 'p2' },
  { type: 'hit', src: 'p3', dst: 'p2', move: 'finger', lethal: false },
  { type: 'reveal', p: 'p4', move: 'magicBurst' },
  { type: 'cancel', by: 'magicBurst', p: 'p6', move: 'superShock' },
  { type: 'hit', src: 'p4', dst: 'p6', move: 'magicBurst', lethal: false },
  { type: 'reveal', p: 'p5', move: 'voidRift' },
  { type: 'cancel', by: 'voidRift', p: 'p3', move: 'finger' },
  { type: 'clash', a: 'p2', b: 'p3', winner: null },
  { type: 'reveal', p: 'p6', move: 'hammerBoth' },
  { type: 'hit', src: 'p6', dst: 'p3', move: 'hammerBoth', lethal: false },
  { type: 'hit', src: 'p6', dst: 'p4', move: 'hammerBoth', lethal: false },
  { type: 'reveal', p: 'p1', move: 'hammerSky' },
  { type: 'hit', src: 'p1', dst: 'p3', move: 'hammerSky', lethal: true },
  { type: 'death', p: 'p3' },
  { type: 'reveal', p: 'p2', move: 'ultimate' },
  { type: 'hit', src: 'p2', dst: 'p4', move: 'ultimate', lethal: true },
  { type: 'death', p: 'p4' },
  { type: 'reveal', p: 'p5', move: 'superShield' },
  { type: 'reveal', p: 'p6', move: 'superShock', target: 'p5' },
  { type: 'blocked', src: 'p6', dst: 'p5', move: 'superShock', by: 'superShield' },
  { type: 'roundEnd', round: 1 },
];

function playShowcase() {
  if (!arena || playing.value) return;
  playing.value = true;
  pending.value = null;
  if (stateTimer) clearTimeout(stateTimer);
  arena.highlightTargets([]);
  arena.setPlayers(PLAYERS, 'p1');
  arena.playRound(SHOWCASE, nameOf);
  setTimeout(() => (playing.value = false), roundPlaybackMs(SHOWCASE));
}
</script>

<template>
  <div class="game-root">
    <div class="game-main">
      <div class="round-banner">
        <div class="round-label">演武场 · 水墨特效调试</div>
        <div class="row" style="gap: 6px">
          <button
            v-for="n in [4, 6, 9]" :key="n" class="ghost seat-n"
            :class="{ on: seatCount === n }" :style="seatCount === n ? '' : 'opacity:.55'"
            @click="setCount(n)"
          >{{ n }} 人</button>
        </div>
      </div>
      <div ref="arenaEl" class="game-stage" />
      <div v-if="pending" class="pick-hint">
        <b>【{{ MOVES[pending].name }}】</b>{{ SHIELD_MOVES.includes(pending) ? '点圆点选定施放对象（含自己）' : '点场中圆点选定目标' }}
        <button class="ghost" style="padding: 5px 14px" @click="clearPending">收回</button>
      </div>
      <div v-else class="pick-hint muted">盾类可给任意座次上盾 · 单体神通先点招式再点对手 · 状态招 3 秒后自动消除</div>
    </div>

    <aside class="game-side">
      <div class="side-head">
        <span class="brand-title" style="font-size: 24px">演武场</span>
        <button class="big" style="min-width: 150px; padding: 8px" :disabled="playing" @click="playShowcase">
          {{ playing ? '演出中…' : '完整回合连播' }}
        </button>
      </div>
      <div class="skill-scroll">
        <template v-for="cost in [0, 1, 2, 3] as const" :key="cost">
          <div class="tier">{{ ['免费招', '消耗 1V', '消耗 2V', '消耗 3V'][cost] }}</div>
          <button v-for="m in MOVE_ORDER.filter(x => MOVES[x].cost === cost)" :key="m" class="skill-btn"
            :class="{ pending: pending === m }" @click="play(m)">
            <span class="sk-name">{{ MOVES[m].name }}</span>
            <span class="sk-cost">{{ MOVES[m].cost ? MOVES[m].cost + 'V' : '免费' }}</span>
            <span class="sk-desc">{{ MOVES[m].flavor }}</span>
          </button>
        </template>
      </div>
    </aside>
  </div>
</template>
