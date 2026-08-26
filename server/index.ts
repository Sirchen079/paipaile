import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import { Server } from 'socket.io';
import { makeAuth, makeLoginThrottle, parseCookies, type Role } from './auth';
import { RoomManager } from './rooms';

// 极简 .env 加载（无第三方依赖）
try {
  for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
} catch { /* .env 不存在则跳过 */ }

const PORT = Number(process.env.PORT || 25173);
const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD || 'paipai2026';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const COOKIE_SECRET = process.env.COOKIE_SECRET || Math.random().toString(36).slice(2);

if (!process.env.ACCESS_PASSWORD) {
  console.warn('[警告] 未设置 ACCESS_PASSWORD，当前使用默认密码 paipai2026，上线前务必修改（.env）');
}

const auth = makeAuth(COOKIE_SECRET, ACCESS_PASSWORD, ADMIN_PASSWORD);
const throttle = makeLoginThrottle();
const app = express();
app.use(express.json());

const COOKIE_NAME = 'ppa_token';

app.post('/api/login', (req, res) => {
  const ip = req.ip ?? 'unknown';
  if (throttle.locked(ip)) {
    res.status(429).json({ ok: false, error: '尝试次数过多，请 1 分钟后再试' });
    return;
  }
  const { password } = req.body ?? {};
  let role: Role | null = null;
  if (typeof password === 'string') {
    if (auth.checkAdmin(password)) role = 'admin';
    else if (auth.checkPassword(password)) role = 'player';
  }
  if (role) {
    throttle.reset(ip);
    const { token, maxAge } = auth.issueToken(role);
    res.cookie(COOKIE_NAME, token, { httpOnly: true, sameSite: 'lax', maxAge: maxAge * 1000, path: '/' });
    res.json({ ok: true, role });
  } else {
    throttle.fail(ip);
    res.status(401).json({ ok: false, error: '密码不对' });
  }
});

app.get('/api/me', (req, res) => {
  const role = auth.verifyToken(parseCookies(req.headers.cookie)[COOKIE_NAME]);
  res.status(role ? 200 : 401).json({ ok: !!role, role: role ?? undefined });
});

// 静态前端（生产构建产物；开发时由 Vite 独立提供）
const webDist = path.resolve(process.cwd(), 'web', 'dist');
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
}

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, credentials: true } });

// WebSocket 握手鉴权：必须带有效 cookie（管理员令牌同样放行，管理员也能下场游玩）
io.use((socket, next) => {
  const role = auth.verifyToken(parseCookies(socket.handshake.headers.cookie)[COOKIE_NAME]);
  if (role) next();
  else next(new Error('unauthorized'));
});

const manager = new RoomManager(io);
setInterval(() => manager.sweep(), 60_000).unref();

io.on('connection', (socket) => {
  let roomCode: string | null = null;

  const getRoom = () => (roomCode ? manager.get(roomCode) : undefined);

  // 同一 socket 换房前先退出旧房间（防御：正常前端不会触发，但别让座位与广播泄漏到旧房）
  const leaveOldRoom = () => {
    if (!roomCode) return;
    const old = manager.get(roomCode);
    if (old) old.leave(socket.id);
    roomCode = null;
  };

  socket.on('room:create', (payload: { nickname?: string; avatar?: string }, ack?: (r: any) => void) => {
    leaveOldRoom();
    const room = manager.create();
    const r = room.join(socket, payload?.nickname ?? '', payload?.avatar ?? '');
    if (r.ok) roomCode = room.code;
    ack?.(r.ok ? { ok: true, code: room.code } : r);
  });

  socket.on('room:join', (payload: { code?: string; nickname?: string; avatar?: string }, ack?: (r: any) => void) => {
    const room = manager.get(payload?.code ?? '');
    if (!room) { ack?.({ ok: false, error: '房间不存在' }); return; }
    if (roomCode !== room.code) leaveOldRoom();
    const r = room.join(socket, payload?.nickname ?? '', payload?.avatar ?? '');
    if (r.ok) roomCode = room.code;
    ack?.(r);
  });

  socket.on('room:config', (patch: any, ack?: (r: any) => void) => {
    ack?.(getRoom()?.setConfig(socket.id, patch) ?? { ok: false, error: '不在房间中' });
  });

  socket.on('game:start', (_payload: any, ack?: (r: any) => void) => {
    ack?.(getRoom()?.start(socket.id) ?? { ok: false, error: '不在房间中' });
  });

  socket.on('game:submit', (sub: any, ack?: (r: any) => void) => {
    ack?.(getRoom()?.submit(socket.id, sub) ?? { ok: false, error: '不在房间中' });
  });

  socket.on('room:leave', () => {
    const room = getRoom();
    if (room) room.leave(socket.id);
    roomCode = null;
    socket.emit('room:left');
  });

  socket.on('disconnect', () => {
    const room = getRoom();
    if (room) room.handleDisconnect(socket.id);
    roomCode = null;
  });
});

server.listen(PORT, () => {
  console.log(`拍拍乐服务已启动: http://localhost:${PORT} （访问密码${process.env.ACCESS_PASSWORD ? '' : '为默认值，注意修改'}）`);
  if (ADMIN_PASSWORD) console.log('管理员密码已启用：用它登录将直接进入演武场');
});
