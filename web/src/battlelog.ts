import { MOVES } from '@shared/moves';
import type { GameEvent } from '@shared/types';

export interface LogLine {
  text: string;
  cls: string;
}

const MOVE_NAMES: Record<string, string> = Object.fromEntries(
  Object.values(MOVES).map((m) => [m.id, m.name]),
);

export function eventToLine(ev: GameEvent, name: (id: string) => string): LogLine | null {
  const n = name;
  switch (ev.type) {
    case 'reveal':
      return { text: `${n(ev.p)} 使出【${MOVE_NAMES[ev.move]}】${ev.target ? `→ ${n(ev.target)}` : ''}`, cls: 'reveal' };
    case 'vChange':
      if (ev.delta > 0) return { text: `⚡ ${n(ev.p)} 充能成功，V=${ev.v}`, cls: 'charge' };
      return null;
    case 'stance':
      return { text: `${n(ev.p)} ${ev.move === 'flyUp' ? '腾空飞天 ✈️' : '遁入地下 ⛏️'}`, cls: 'reveal' };
    case 'cancel':
      return { text: `💢 ${n(ev.p)} 的【${MOVE_NAMES[ev.move]}】被【${ev.by === 'magicBurst' ? '魔爆术' : '扭曲虚空'}】取消了！`, cls: 'cancel' };
    case 'clash':
      return ev.winner
        ? { text: `⚔️ ${n(ev.a)} 与 ${n(ev.b)} 对冲，${n(ev.winner)} 压制了对方！`, cls: 'clash' }
        : { text: `⚔️ ${n(ev.a)} 与 ${n(ev.b)} 对冲，双方互相抵消！`, cls: 'clash' };
    case 'hit':
      return { text: `💥 ${n(ev.src)} 的【${MOVE_NAMES[ev.move]}】命中 ${n(ev.dst)}！${ev.lethal ? '💀' : ''}`, cls: 'hit' };
    case 'blocked':
      return { text: `🛡️ ${n(ev.dst)} 的${ev.by === 'superShield' ? '超级盾' : '普通盾'}挡下了 ${n(ev.src)} 的【${MOVE_NAMES[ev.move]}】`, cls: 'blocked' };
    case 'miss':
      return {
        text: ev.reason === 'flyUp' ? `🌀 ${n(ev.dst)} 已飞天，${n(ev.src)} 的攻击落空`
          : ev.reason === 'burrow' ? `🌀 ${n(ev.dst)} 已遁地，${n(ev.src)} 的攻击落空`
            : `✨ ${n(ev.dst)} 的架势毫发无损，${n(ev.src)} 的【${MOVE_NAMES[ev.move]}】无效`,
        cls: 'miss',
      };
    case 'death':
      return { text: `☠️ ${n(ev.p)} 被淘汰了！`, cls: 'death' };
    case 'roundEnd':
      return { text: `── 第 ${ev.round} 回合结束 ──`, cls: 'roundend' };
    default:
      return null;
  }
}
