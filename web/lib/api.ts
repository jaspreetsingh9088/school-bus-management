'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000').replace(/\/$/, '');
export const APK_URL =
  process.env.NEXT_PUBLIC_APK_URL ??
  'https://github.com/jaspreetsingh9088/school-bus-management/releases/latest/download/school-bus.apk';

const TOKEN_KEY = 'sb_admin_token';
const USER_KEY = 'sb_admin_user';

export interface SessionUser {
  id: string;
  name: string;
  role: string;
  companyId: string | null;
  companyName?: string;
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getUser(): SessionUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveSession(token: string, user: SessionUser) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch {
    /* ignore */
  }
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
  }
}

export async function api<T = any>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_URL}/api/v1${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (res.status === 401 && path !== '/auth/login') {
    clearSession();
    if (typeof window !== 'undefined') window.location.href = '/login/';
  }
  if (!res.ok) {
    const msg = Array.isArray(data?.message) ? data.message.join(', ') : data?.message ?? `Request failed (${res.status})`;
    throw new ApiError(res.status, msg, data);
  }
  return data as T;
}

/** Loads data, and reloads it every `intervalMs` if given (used for live screens). */
export function useApi<T = any>(path: string | null, intervalMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const pathRef = useRef(path);
  pathRef.current = path;

  const load = useCallback(async () => {
    if (!pathRef.current) return;
    try {
      const result = await api<T>(pathRef.current);
      setData(result);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    load();
    if (!intervalMs) return;
    const t = setInterval(load, intervalMs);
    return () => clearInterval(t);
  }, [path, intervalMs, load]);

  return { data, error, loading, reload: load };
}

export function todayIST(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
}

export function timeAgo(iso?: string | null): string {
  if (!iso) return 'never';
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
}

export const STATUS_LABEL: Record<string, string> = {
  SCHEDULED: 'Waiting',
  ABSENT: 'Absent',
  BOARDED: 'On bus',
  NO_SHOW: 'No-show',
  AT_SCHOOL: 'At school',
  HANDED_OVER: 'Handed over',
  DROPPED_ALONE: 'Dropped (alone)',
  HELD: 'Held — no adult',
  RETURNED: 'Returned',
  IN_PROGRESS: 'Running',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  PENDING_APPROVAL: 'Pending approval',
  PAID: 'Paid',
  PARTLY_PAID: 'Partly paid',
  PENDING: 'Pending',
  OVERDUE: 'Overdue',
  ACTIVE: 'Active',
  SUSPENDED: 'Suspended',
  INACTIVE: 'Inactive',
  MAINTENANCE: 'Maintenance',
};

export const STATUS_TONE: Record<string, 'good' | 'warn' | 'bad' | 'info' | 'muted'> = {
  BOARDED: 'info', AT_SCHOOL: 'good', HANDED_OVER: 'good', DROPPED_ALONE: 'good', ABSENT: 'muted', SCHEDULED: 'muted',
  NO_SHOW: 'warn', HELD: 'bad', RETURNED: 'bad', IN_PROGRESS: 'info', COMPLETED: 'good', ACTIVE: 'good',
  PENDING_APPROVAL: 'warn', SUSPENDED: 'warn', INACTIVE: 'muted', MAINTENANCE: 'warn',
  PAID: 'good', PARTLY_PAID: 'info', PENDING: 'warn', OVERDUE: 'bad',
};

/** Downloads a CSV from the API (needs the login token, so it can't be a plain link). */
export async function downloadCsv(path: string, filename: string) {
  const token = getToken();
  const res = await fetch(`${API_URL}/api/v1${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new ApiError(res.status, `Download failed (${res.status})`);
  const blob = new Blob(['\uFEFF', await res.text()], { type: 'text/csv;charset=utf-8' }); // BOM so Excel shows ₹ correctly
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
