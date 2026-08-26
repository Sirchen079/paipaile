import { io } from 'socket.io-client';

export const socket = io({ autoConnect: false });

export interface Profile {
  nickname: string;
  avatar: string;
}

export const AVATARS = ['jianxiu', 'daozun', 'mozun', 'xianzi'] as const;
export type AvatarId = typeof AVATARS[number];

export const AVATAR_LABEL: Record<AvatarId, string> = {
  jianxiu: '剑修', daozun: '道尊', mozun: '魔尊', xianzi: '仙子',
};

export function loadProfile(): Profile {
  try {
    const p = JSON.parse(localStorage.getItem('pp_profile') || '');
    // 旧档案里的 avatar 可能已不在当前法相库，校验防 404 头像
    if (p && typeof p.nickname === 'string' && (AVATARS as readonly string[]).includes(p.avatar)) {
      return p as Profile;
    }
  } catch { /* ignore */ }
  return { nickname: '', avatar: AVATARS[Math.floor(Math.random() * AVATARS.length)] };
}

export function saveProfile(p: Profile) {
  localStorage.setItem('pp_profile', JSON.stringify(p));
}
