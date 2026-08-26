export async function checkAuth(): Promise<boolean> {
  try {
    // 服务不可达时 6s 超时放行到登录页，别把用户永远钉在 loading
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 6000);
    try {
      const r = await fetch('/api/me', { signal: ctl.signal });
      return r.ok;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
}

export async function login(password: string): Promise<string | null> {
  try {
    const r = await fetch('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (r.ok) return null;
    const j = await r.json().catch(() => ({}));
    return (j as { error?: string }).error || '登录失败';
  } catch {
    return '网络错误，请稍后再试';
  }
}
