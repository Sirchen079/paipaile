import crypto from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import { resolveRound, checkWin } from '../shared/engine';
import { MOVES } from '../shared/moves';
import { roundPlaybackMs } from '../shared/pacing';
import type { GameEvent, PlayerState, Submission, WinCheck } from '../shared/types';

export interface RoomConfig {
  hp: number;
  pickSeconds: number;
  friendlyFire: boolean;
}

export type Phase = 'lobby' | 'pick' | 'show' | 'end';

export const MAX_PLAYERS = 9;

/** 头像白名单：客户端传来的 avatar 只允许落在这几个已托管资源内，防外链/脏数据注入 */
const AVATARS = new Set(['daozun', 'jianxiu', 'mozun', 'xianzi']);
const safeAvatar = (a: string) => (AVATARS.has(a) ? a : 'jianxiu');

interface PublicPlayer {
  id: string; name: string; avatar: string;
  hp: number; v: number; alive: boolean; connected: boolean;
  picked: boolean;
}

export class Room {
  readonly code: string;
  private io: Server;
  players: PlayerState[] = [];
  config: RoomConfig = { hp: 1, pickSeconds: 15, friendlyFire: false };
  phase: Phase = 'lobby';
  round = 0;
  deadline = 0;
  hostId = '';
  private submissions = new Map<string, Submission>();
  private timer: NodeJS.Timeout | null = null;
  /** 全员掉线时刻（>0 且超过宽限期的房间可回收；留座便于断线重连） */
  private ghostSince = 0;
  static readonly GHOST_GRACE_MS = 10 * 60 * 1000;

  constructor(io: Server, code: string) {
    this.io = io;
    this.code = code;
  }

  private clearTimer() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }

  private showMs(events: GameEvent[]): number {
    // 与前端 playRound 的节奏表一致，上限放宽到 20s 以容纳大招连发
    return Math.min(20000, roundPlaybackMs(events));
  }

  isEmpty(): boolean { return this.players.length === 0; }

  /** 全员掉线且超过宽限期（空留座房间不再无限驻留内存） */
  recyclable(now = Date.now()): boolean {
    return this.ghostSince > 0 && now - this.ghostSince > Room.GHOST_GRACE_MS;
  }

  private touchGhostClock() {
    this.ghostSince = this.players.every((p) => !p.connected) && this.players.length > 0
      ? (this.ghostSince || Date.now())
      : 0;
  }

  findPlayer(id: string): PlayerState | undefined {
    return this.players.find((p) => p.id === id);
  }

  join(socket: Socket, nickname: string, avatar: string): { ok: boolean; error?: string } {
    const name = (nickname ?? '').trim().slice(0, 12);
    if (!name) return { ok: false, error: '昵称不能为空' };
    // 断线重连：同名离线玩家直接接管原座位（保留血量/V/状态）
    const ghost = this.players.find((p) => !p.connected && p.name.toLowerCase() === name.toLowerCase());
    if (ghost) {
      ghost.id = socket.id;
      ghost.connected = true;
      ghost.avatar = safeAvatar(avatar);
      this.touchGhostClock();
      socket.join(this.code);
      this.sync();
      return { ok: true };
    }
    if (this.players.length >= MAX_PLAYERS) return { ok: false, error: '房间已满（最多 9 人）' };
    if (this.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) return { ok: false, error: '昵称已被使用' };
    const player: PlayerState = {
      id: socket.id, name, avatar: safeAvatar(avatar),
      hp: this.config.hp, v: 0, alive: true, connected: true,
    };
    this.players.push(player);
    if (!this.hostId) this.hostId = player.id;
    socket.join(this.code);
    this.sync();
    return { ok: true };
  }

  handleDisconnect(playerId: string) {
    const p = this.findPlayer(playerId);
    if (!p) return;
    p.connected = false;
    this.submissions.delete(playerId);
    this.touchGhostClock();
    if (this.isEmpty()) { this.clearTimer(); return; }
    if (this.hostId === playerId) this.hostId = this.players[0].id;
    this.endIfDecided();
    this.sync();
  }

  leave(playerId: string) {
    this.players = this.players.filter((p) => p.id !== playerId);
    this.submissions.delete(playerId);
    this.touchGhostClock();
    if (this.isEmpty()) { this.clearTimer(); return; }
    if (this.hostId === playerId) this.hostId = this.players[0].id;
    // 主动离场与掉线同规：对局中活人 ≤1 即刻终局（否则残局每轮空转倒计时）
    this.endIfDecided();
    this.sync();
  }

  /** 对局进行中若存活人数不足以继续（≤1），立即终局；返回是否已收场 */
  private endIfDecided(): boolean {
    if (this.phase !== 'pick' && this.phase !== 'show') return false;
    const alive = this.players.filter((x) => x.alive);
    if (alive.length > 1) {
      // 出招阶段全员已亮牌（含离场者移除后）也直接开算，不干等超时
      if (this.phase === 'pick' && this.allSubmitted()) { this.resolveNow(); return true; }
      return false;
    }
    this.clearTimer();
    this.endGame({ over: true, winners: alive.map((x) => x.id), draw: alive.length === 0 });
    return true;
  }

  setConfig(playerId: string, patch: Partial<RoomConfig>): { ok: boolean; error?: string } {
    if (playerId !== this.hostId) return { ok: false, error: '只有房主能改设置' };
    if (this.phase !== 'lobby' && this.phase !== 'end') return { ok: false, error: '游戏中不能改设置' };
    if (patch.hp !== undefined) {
      if (!Number.isInteger(patch.hp) || patch.hp < 1 || patch.hp > 10) return { ok: false, error: '血量范围 1~10' };
      this.config.hp = patch.hp;
      for (const p of this.players) p.hp = this.config.hp;
    }
    if (patch.pickSeconds !== undefined) {
      if (![10, 15, 20, 30].includes(patch.pickSeconds)) return { ok: false, error: '倒计时可选 10/15/20/30 秒' };
      this.config.pickSeconds = patch.pickSeconds;
    }
    if (patch.friendlyFire !== undefined) this.config.friendlyFire = !!patch.friendlyFire;
    this.sync();
    return { ok: true };
  }

  start(playerId: string): { ok: boolean; error?: string } {
    if (playerId !== this.hostId) return { ok: false, error: '只有房主能开始游戏' };
    if (this.phase === 'pick' || this.phase === 'show') return { ok: false, error: '对局进行中，不能重新开始' };
    if (this.players.length < 2) return { ok: false, error: '至少 2 人才能开始' };
    this.clearTimer();
    for (const p of this.players) { p.hp = this.config.hp; p.v = 0; p.alive = true; }
    this.round = 0;
    this.nextRound();
    return { ok: true };
  }

  private allSubmitted(): boolean {
    return this.players.filter((p) => p.alive).every((p) => this.submissions.has(p.id));
  }

  private nextRound() {
    this.round += 1;
    this.submissions.clear();
    this.phase = 'pick';
    this.deadline = Date.now() + this.config.pickSeconds * 1000;
    this.io.to(this.code).emit('game:phase', {
      phase: 'pick', round: this.round, deadline: this.deadline, serverNow: Date.now(),
    });
    this.sync();
    this.timer = setTimeout(() => this.resolveNow(), this.config.pickSeconds * 1000 + 250);
  }

  submit(playerId: string, sub: { moveId: string; targetId?: string }): { ok: boolean; error?: string } {
    if (this.phase !== 'pick') return { ok: false, error: '当前不是出招阶段' };
    const p = this.findPlayer(playerId);
    if (!p || !p.alive) return { ok: false, error: '你已无法行动' };
    if (this.submissions.has(playerId)) return { ok: false, error: '本回合已出招' };
    const def = MOVES[sub.moveId as keyof typeof MOVES];
    if (!def) return { ok: false, error: '未知招式' };
    if (def.cost > p.v) return { ok: false, error: 'V 不足' };
    if (def.needsTarget) {
      const t = sub.targetId ? this.findPlayer(sub.targetId) : undefined;
      if (!t || !t.alive || t.id === playerId) return { ok: false, error: '目标无效' };
      if (!this.config.friendlyFire && p.team && t.team === p.team) return { ok: false, error: '友伤已关闭，不能指定队友' };
    }
    this.submissions.set(playerId, { playerId, moveId: def.id, targetId: sub.targetId });
    this.io.to(this.code).emit('pick:progress', { playerId });
    this.sync();
    if (this.allSubmitted()) { this.clearTimer(); this.resolveNow(); }
    return { ok: true };
  }

  private resolveNow() {
    if (this.phase !== 'pick') return;
    this.clearTimer();
    this.phase = 'show';
    const result = resolveRound(this.players, [...this.submissions.values()], { friendlyFire: this.config.friendlyFire }, this.round);
    this.players = result.players;
    this.io.to(this.code).emit('round:result', {
      round: this.round,
      events: result.events,
      standings: this.publicPlayers(),
    });
    this.sync();
    const win = checkWin(this.players);
    this.timer = setTimeout(() => {
      if (win.over) this.endGame(win);
      else this.nextRound();
    }, this.showMs(result.events));
  }

  private endGame(win: WinCheck) {
    this.clearTimer();
    this.phase = 'end';
    this.io.to(this.code).emit('game:end', {
      winners: win.winners, draw: win.draw, standings: this.publicPlayers(),
    });
    this.sync();
  }

  private publicPlayers(): PublicPlayer[] {
    return this.players.map((p) => ({
      id: p.id, name: p.name, avatar: p.avatar,
      hp: p.hp, v: p.v, alive: p.alive, connected: p.connected,
      picked: this.phase === 'pick' && this.submissions.has(p.id),
    }));
  }

  sync() {
    this.io.to(this.code).emit('room:state', {
      code: this.code,
      hostId: this.hostId,
      phase: this.phase,
      round: this.round,
      deadline: this.deadline,
      serverNow: Date.now(),
      config: this.config,
      players: this.publicPlayers(),
    });
  }
}

export class RoomManager {
  private rooms = new Map<string, Room>();
  constructor(private io: Server) {}

  create(): Room {
    let code = '';
    do {
      code = String(crypto.randomInt(1000, 10000));   // 密码学随机，避免 Math.random 可预测
    } while (this.rooms.has(code));
    const room = new Room(this.io, code);
    this.rooms.set(code, room);
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get((code ?? '').trim());
  }

  sweep() {
    for (const [code, room] of this.rooms) {
      if (room.isEmpty() || room.recyclable()) this.rooms.delete(code);
    }
  }
}
