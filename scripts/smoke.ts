/**
 * 冒烟测试：模拟 3 个客户端连上本地服务端打完整一局。
 * 前置：npm run dev（服务端跑在 :25173，密码取 ACCESS_PASSWORD 或默认 paipai2026）
 */
import { io, type Socket } from 'socket.io-client';
import { MOVES, MOVE_ORDER } from '../shared/moves';
import type { GameEvent, MoveId } from '../shared/types';

const BASE = 'http://localhost:25173';
const PASSWORD = process.env.ACCESS_PASSWORD || 'paipai2026';

async function login(): Promise<string> {
  let res = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'wrong-password' }),
  });
  if (res.status !== 401) throw new Error(`错误密码应返回 401，实际 ${res.status}`);
  res = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`正确密码登录失败: ${res.status}`);
  const token = /ppa_token=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')?.[1];
  if (!token) throw new Error('未拿到登录 cookie');
  return token;
}

interface SnapPlayer { id: string; name: string; alive: boolean; hp: number; v: number }
interface Snapshot { players: SnapPlayer[]; hostId: string }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const waitConnected = (s: Socket) => s.connected
  ? Promise.resolve()
  : new Promise<void>((r) => s.once('connect', () => r()));

async function main() {
  const token = await login();
  const names = ['小明', '小红', '老王'];
  const sockets = names.map(() =>
    io(BASE, { extraHeaders: { Cookie: `ppa_token=${token}` }, reconnection: false, timeout: 5000 }),
  );

  let snapshot: Snapshot | null = null;
  let gameEnd: { winners: string[]; draw: boolean } | null = null;
  let endResolve: () => void;
  const ended = new Promise<void>((r) => { endResolve = r; });
  const fail = (msg: string) => { console.error('❌', msg); process.exit(1); };
  const watchdog = setTimeout(() => fail('120 秒未打完一局，超时'), 120_000);

  sockets.forEach((sock, i) => {
    sock.on('connect_error', (e) => fail(`客户端${names[i]}连接失败: ${e.message}`));
    sock.on('room:state', (s: Snapshot) => { snapshot = s; });
    sock.on('round:result', (r: { round: number; events: GameEvent[]; standings: any[] }) => {
      if (i !== 0) return;
      const deaths = r.events.filter((e) => e.type === 'death').length;
      const hits = r.events.filter((e) => e.type === 'hit').length;
      console.log(`  第${r.round}回合: ${hits} 次命中, ${deaths} 人淘汰, 剩余 ${r.standings.filter((p) => p.alive).length} 人`);
    });
    sock.on('game:end', (e: { winners: string[]; draw: boolean }) => {
      if (!gameEnd) { gameEnd = e; endResolve(); }
    });
    sock.on('game:phase', async (ph: { phase: string; round: number }) => {
      if (ph.phase !== 'pick') return;
      await sleep(150); // 等 room:state 快照到达
      const snap = snapshot;
      const me = snap?.players.find((p) => p.id === sock.id);
      if (!snap || !me || !me.alive) return;
      const affordable = MOVE_ORDER.filter((m) => MOVES[m].cost <= me.v);
      const ATTACKS = ['shock', 'superShock', 'finger', 'hammerSky', 'hammerGround', 'hammerBoth', 'magicBurst', 'voidRift', 'ultimate'];
      const attacks = affordable.filter((m) => ATTACKS.includes(m));
      // 纯进攻型机器人：能攻击必攻击，尽快分出胜负
      const pool = attacks.length ? attacks : affordable;
      // 偏好单体直伤（命中率高，缩短局数；仍保留概率覆盖 AoE/反制招）
      const DIRECT = ['shock', 'superShock', 'finger', 'ultimate'];
      const directs = pool.filter((m) => DIRECT.includes(m));
      const useDirect = directs.length > 0 && Math.random() < 0.6;
      const finalPool = useDirect ? directs : pool;
      const moveId = finalPool[Math.floor(Math.random() * finalPool.length)] as MoveId;
      let targetId: string | undefined;
      if (MOVES[moveId].needsTarget) {
        // 链式指目标（A→B→C→A 环）：杜绝互指对冲抵消，保证每回合稳定产生命中
        const sortedIds = snap.players.filter((p) => p.alive).map((p) => p.id).sort();
        const pos = sortedIds.indexOf(sock.id ?? '');
        if (pos >= 0) targetId = sortedIds[(pos + 1) % sortedIds.length];
      }
      sock.emit('game:submit', { moveId, targetId }, (r: any) => {
        if (!r?.ok) fail(`出招被拒: ${r?.error}`);
      });
    });
  });

  await Promise.all(sockets.map(waitConnected));

  const [host, ...guests] = sockets;
  const createRes: any = await new Promise((r) => host.emit('room:create', { nickname: names[0], avatar: '🐯' }, r));
  if (!createRes?.ok) return fail(`建房失败: ${createRes?.error}`);
  console.log(`✓ 房间 ${createRes.code} 已创建`);

  for (let i = 0; i < guests.length; i++) {
    const r: any = await new Promise((res) => guests[i].emit('room:join', { code: createRes.code, nickname: names[i + 1], avatar: '🐰' }, res));
    if (!r?.ok) return fail(`加入失败: ${r?.error}`);
  }
  console.log('✓ 3 名玩家就位');

  const cfgRes: any = await new Promise((r) => host.emit('room:config', { hp: 1, pickSeconds: 10 }, r));
  if (!cfgRes?.ok) return fail(`配置失败: ${cfgRes?.error}`);
  const startRes: any = await new Promise((r) => host.emit('game:start', {}, r));
  if (!startRes?.ok) return fail(`开始失败: ${startRes?.error}`);
  console.log('✓ 游戏开始（1 血、10 秒出招，机器人秒出凑齐即结算）');

  await ended;
  clearTimeout(watchdog);
  const snap = snapshot!;
  const winnerNames = (gameEnd!.winners ?? []).map((id) => snap.players.find((p) => p.id === id)?.name ?? id);
  console.log(gameEnd!.draw ? '✓ 对局结束：平局（同归于尽）' : `✓ 对局结束，胜者：${winnerNames.join('、') || '无'}`);
  sockets.forEach((s) => s.close());
  process.exit(0);
}

main().catch((e) => { console.error('❌', e.message); process.exit(1); });
