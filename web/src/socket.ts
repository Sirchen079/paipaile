import { io } from 'socket.io-client';

export const socket = io({ autoConnect: false });

export interface Profile {
  nickname: string;
  avatar: string;
}

export const AVATARS = ['🐯', '🐰', '🐸', '🐵', '🐼', '🦊', '🐷', '🦁', '🐧', '🐙', '🦄', '🐲', '👻', '🤖', '🎃', '😎'];

export function loadProfile(): Profile {
  try {
    const p = JSON.parse(localStorage.getItem('pp_profile') || '');
    if (p && typeof p.nickname === 'string') return p;
  } catch { /* ignore */ }
  return { nickname: '', avatar: AVATARS[Math.floor(Math.random() * AVATARS.length)] };
}

export function saveProfile(p: Profile) {
  localStorage.setItem('pp_profile', JSON.stringify(p));
}
