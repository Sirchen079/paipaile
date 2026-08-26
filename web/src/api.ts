export type Role = 'admin' | 'player';

/** 已登录则返回角色（管理员登录直达演武场），未登录返回 null；6s 超时放行到登录页，别把用户钉在 loading */
export async function checkAuth(): Promise<Role | null> {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 6000);
    try {
      const r = await fetch('/api/me', { signal: ctl.signal });
      if (!r.ok) return null;
      const j = await r.json().catch(() => ({}));
      return (j as { role?: Role }).role === 'admin' ? 'admin' : 'player';
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

export async function login(password: string): Promise<{ error: string } | { role: Role }> {
  try {
    const r = await fetch('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok) return { role: (j as { role?: Role }).role === 'admin' ? 'admin' : 'player' };
    return { error: (j as { error?: string }).error || '登录失败' };
  } catch {
    return { error: '网络错误，请稍后再试' };
  }
}
