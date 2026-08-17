export async function checkAuth(): Promise<boolean> {
  try {
    const r = await fetch('/api/me');
    return r.ok;
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
