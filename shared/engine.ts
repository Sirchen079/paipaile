import { MOVES } from './moves';
import type {
  EngineConfig, GameEvent, MoveId, PlayerState, RoundResult, Submission, WinCheck,
} from './types';

export const V_CAP = 99;

/** 单体招能命中哪些出招状态的人（设计文档 §3.3 受击判定总表） */
const SINGLE_HIT_TABLE: Record<'shock' | 'superShock' | 'finger', MoveId[]> = {
  shock: ['charge', 'shock', 'superShock'],
  superShock: ['charge', 'shield', 'shock', 'superShock', 'hammerSky', 'hammerGround', 'voidRift'],
  finger: ['charge', 'shield', 'superShield', 'shock', 'superShock', 'finger', 'hammerBoth'],
};

/** 单体招被哪种盾挡住 */
const SINGLE_BLOCKED_BY: Record<'shock' | 'superShock' | 'finger', MoveId[]> = {
  shock: ['shield', 'superShield'],
  superShock: ['superShield'],
  finger: [],
};

/** 范围招命中哪些出招状态的人 */
function aoeTargets(move: 'hammerSky' | 'hammerGround' | 'hammerBoth' | 'magicBurst' | 'voidRift' | 'ultimate', m: MoveId): boolean {
  switch (move) {
    case 'hammerSky': return m === 'flyUp';
    case 'hammerGround': return m === 'burrow';
    case 'hammerBoth': return m === 'flyUp' || m === 'burrow' || m === 'magicBurst';
    case 'magicBurst': return m === 'shock' || m === 'superShock' || m === 'ultimate';
    case 'voidRift': return m === 'finger';
    case 'ultimate':
      return m === 'flyUp' || m === 'burrow' || m === 'hammerSky' || m === 'hammerGround'
        || m === 'shock' || m === 'superShock' || m === 'shield' || m === 'voidRift';
  }
}

type ActiveMove = { moveId: MoveId; targetId?: string };

/**
 * 回合结算纯函数：输入全体玩家与本回合出招，输出事件流与新状态。
 * 结算管线（设计文档 §3.2）：收招校验 → V结算 → 状态层 → 取消层 → 对冲层 → 伤害层（同时扣血）→ 淘汰。
 */
export function resolveRound(
  playersIn: PlayerState[],
  submissions: Submission[],
  config: EngineConfig,
  round: number,
): RoundResult {
  const players = playersIn.map((p) => ({ ...p }));
  const byId = new Map(players.map((p) => [p.id, p]));
  const alive = players.filter((p) => p.alive);
  const events: GameEvent[] = [];

  // 0. 收招校验：非法/缺失出招一律按爆V处理（超时自动爆V 同路径）
  const moves = new Map<string, ActiveMove>();
  for (const p of alive) {
    const s = submissions.find((x) => x.playerId === p.id);
    let ok = false;
    if (s && MOVES[s.moveId]) {
      const def = MOVES[s.moveId];
      if (def.cost <= p.v) {
        if (def.needsTarget) {
          const t = s.targetId ? byId.get(s.targetId) : undefined;
          ok = !!t && t.alive && t.id !== p.id;
          if (ok && !config.friendlyFire && p.team && t!.team === p.team) ok = false;
        } else {
          ok = true;
        }
      }
    }
    moves.set(p.id, ok && s ? { moveId: s.moveId, targetId: s.targetId } : { moveId: 'charge' });
  }

  const moveOf = (pid: string): MoveId => moves.get(pid)!.moveId;

  // reveal
  for (const p of alive) {
    const m = moves.get(p.id)!;
    events.push({ type: 'reveal', p: p.id, move: m.moveId, target: m.targetId });
  }

  // 1. V 结算：先扣费，再结算爆V（封顶 99）
  for (const p of alive) {
    const cost = MOVES[moveOf(p.id)].cost;
    if (cost > 0) {
      p.v -= cost;
      events.push({ type: 'vChange', p: p.id, delta: -cost, v: p.v });
    }
  }
  for (const p of alive) {
    if (moveOf(p.id) === 'charge') {
      p.v = Math.min(V_CAP, p.v + 1);
      events.push({ type: 'vChange', p: p.id, delta: 1, v: p.v });
    }
  }

  // 2. 状态层
  for (const p of alive) {
    const m = moveOf(p.id);
    if (m === 'flyUp' || m === 'burrow') events.push({ type: 'stance', p: p.id, move: m });
  }

  // 3. 取消层：魔爆取消全部冲击波（普/超/究极，裁定 D2）；扭曲虚空取消全部一阳指
  const canceled = new Set<string>();
  const hasMagicBurst = alive.some((p) => moveOf(p.id) === 'magicBurst');
  const hasVoidRift = alive.some((p) => moveOf(p.id) === 'voidRift');
  if (hasMagicBurst || hasVoidRift) {
    for (const p of alive) {
      const m = moveOf(p.id);
      if ((hasMagicBurst && (m === 'shock' || m === 'superShock' || m === 'ultimate'))
        || (hasVoidRift && m === 'finger')) {
        canceled.add(p.id);
        events.push({ type: 'cancel', by: hasMagicBurst && m !== 'finger' ? 'magicBurst' : 'voidRift', p: p.id, move: m });
      }
    }
  }

  // 4. 对冲层：单体招互相指向时按 V 档位裁定（高档命中低档作废；同档互抵，裁定 D3）
  const clashLoser = new Set<string>();
  for (let i = 0; i < alive.length; i++) {
    for (let j = i + 1; j < alive.length; j++) {
      const a = alive[i], b = alive[j];
      const ma = moves.get(a.id)!, mb = moves.get(b.id)!;
      if (ma.targetId !== b.id || mb.targetId !== a.id) continue;
      if (canceled.has(a.id) || canceled.has(b.id)) continue;
      if (MOVES[ma.moveId].kind !== 'single' || MOVES[mb.moveId].kind !== 'single') continue;
      const ta = MOVES[ma.moveId].cost, tb = MOVES[mb.moveId].cost;
      let winner: string | null;
      if (ta > tb) { winner = a.id; clashLoser.add(b.id); }
      else if (tb > ta) { winner = b.id; clashLoser.add(a.id); }
      else { winner = null; clashLoser.add(a.id); clashLoser.add(b.id); }
      events.push({ type: 'clash', a: a.id, b: b.id, winner });
    }
  }
  const inactive = (pid: string) => canceled.has(pid) || clashLoser.has(pid);

  // 5. 伤害层（先收集全部命中，再统一扣血 → 同回合伤害同时发生）
  const pendingHits: { src: string; dst: string; move: MoveId }[] = [];
  const canHit = (src: PlayerState, dst: PlayerState) =>
    config.friendlyFire || !src.team || src.team !== dst.team;

  for (const src of alive) {
    const am = moves.get(src.id)!;
    if (inactive(src.id)) continue;
    const def = MOVES[am.moveId];
    if (def.kind === 'single') {
      const dst = am.targetId ? byId.get(am.targetId) : undefined;
      if (!dst || !dst.alive) continue;
      const dm = moveOf(dst.id);
      if (dm === 'flyUp' || dm === 'burrow') {
        events.push({ type: 'miss', src: src.id, dst: dst.id, move: am.moveId, reason: dm });
      } else if (SINGLE_BLOCKED_BY[am.moveId as 'shock' | 'superShock' | 'finger'].includes(dm)) {
        events.push({ type: 'blocked', src: src.id, dst: dst.id, move: am.moveId, by: dm === 'superShield' ? 'superShield' : 'shield' });
      } else if (SINGLE_HIT_TABLE[am.moveId as 'shock' | 'superShock' | 'finger'].includes(dm)) {
        if (canHit(src, dst)) pendingHits.push({ src: src.id, dst: dst.id, move: am.moveId });
      } else {
        events.push({ type: 'miss', src: src.id, dst: dst.id, move: am.moveId, reason: 'stance' });
      }
    } else if (def.kind === 'aoe' || def.kind === 'counter') {
      const m = am.moveId as 'hammerSky' | 'hammerGround' | 'hammerBoth' | 'magicBurst' | 'voidRift' | 'ultimate';
      for (const dst of alive) {
        if (dst.id === src.id) continue;
        const dm = moveOf(dst.id);
        if (m === 'ultimate' && dm === 'superShield') {
          events.push({ type: 'blocked', src: src.id, dst: dst.id, move: 'ultimate', by: 'superShield' });
          continue;
        }
        if (!aoeTargets(m, dm)) continue;
        if (canHit(src, dst)) pendingHits.push({ src: src.id, dst: dst.id, move: am.moveId });
      }
    }
  }

  for (const h of pendingHits) {
    const t = byId.get(h.dst)!;
    t.hp -= 1;
    events.push({ type: 'hit', src: h.src, dst: h.dst, move: h.move, lethal: t.hp <= 0 });
  }
  for (const p of alive) {
    if (p.hp <= 0) {
      p.alive = false;
      events.push({ type: 'death', p: p.id });
    }
  }

  events.push({ type: 'roundEnd', round });
  return { events, players };
}

/** 胜负判定：FFA 最后存活者；组队歼灭对方全队；同归于尽算平局 */
export function checkWin(players: PlayerState[]): WinCheck {
  const alivePlayers = players.filter((p) => p.alive);
  const hasTeams = players.some((p) => !!p.team);
  if (!hasTeams) {
    if (alivePlayers.length <= 1) {
      return { over: true, winners: alivePlayers.map((p) => p.id), draw: alivePlayers.length === 0 };
    }
    return { over: false, winners: [], draw: false };
  }
  const aliveTeams = new Set(alivePlayers.map((p) => p.team));
  if (aliveTeams.size <= 1) {
    const winningTeam = aliveTeams.size === 1 ? [...aliveTeams][0] : null;
    return {
      over: true,
      winners: winningTeam ? alivePlayers.filter((p) => p.team === winningTeam).map((p) => p.id) : [],
      draw: winningTeam === null,
    };
  }
  return { over: false, winners: [], draw: false };
}
