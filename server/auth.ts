import crypto from 'node:crypto';

const TTL_MS = 30 * 24 * 3600 * 1000;

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a), bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

export type Role = 'admin' | 'player';

export function makeAuth(secret: string, password: string, adminPassword = '') {
  const sign = (payload: string) =>
    crypto.createHmac('sha256', secret).update(payload).digest('base64url');

  return {
    issueToken(role: Role = 'player'): { token: string; maxAge: number } {
      // 管理员令牌 payload 带 a: 前缀；玩家令牌保持纯时间戳（兼容历史已签发的 cookie）
      const payload = (role === 'admin' ? 'a:' : '') + String(Date.now() + TTL_MS);
      return { token: `${payload}.${sign(payload)}`, maxAge: TTL_MS / 1000 };
    },
    verifyToken(token: string | undefined): Role | null {
      if (!token) return null;
      const dot = token.lastIndexOf('.');
      if (dot <= 0) return null;
      const payload = token.slice(0, dot);
      if (!safeEqual(token.slice(dot + 1), sign(payload))) return null;
      const admin = payload.startsWith('a:');
      const exp = Number(payload.slice(admin ? 2 : 0));
      return Number.isFinite(exp) && exp > Date.now() ? (admin ? 'admin' : 'player') : null;
    },
    checkPassword(attempt: string): boolean {
      return safeEqual(attempt ?? '', password);
    },
    checkAdmin(attempt: string): boolean {
      return adminPassword.length > 0 && safeEqual(attempt ?? '', adminPassword);
    },
  };
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

/** 极简登录限流：单 IP 连续失败 5 次锁 60 秒 */
export function makeLoginThrottle() {
  const fails = new Map<string, { n: number; until: number }>();
  return {
    locked(ip: string): boolean {
      const f = fails.get(ip);
      return !!f && f.n >= 5 && Date.now() < f.until;
    },
    fail(ip: string) {
      const f = fails.get(ip) ?? { n: 0, until: 0 };
      f.n += 1;
      f.until = Date.now() + 60_000;
      fails.set(ip, f);
    },
    reset(ip: string) {
      fails.delete(ip);
    },
  };
}
