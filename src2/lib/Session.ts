import { useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

/**
 * Tiny sessionStorage layer.
 * - Writes are batched (one write per key every ~400 ms) so typing in a 5k-line textarea stays smooth.
 * - Everything is flushed when the tab is hidden or refreshed.
 * - If the browser quota (about 5 MB) is hit, the key is dropped and a warning is raised for the UI.
 */

const PREFIX = 'spdiff:v1:';
const DELAY = 400;

const pending = new Map<string, unknown>();
const failed = new Set<string>();
const listeners = new Set<(msg: string | null) => void>();
let timer: number | undefined;
let disabled = false;

const message = (): string | null =>
  failed.size > 0
    ? 'Session storage is full, so part of your work will not survive a refresh. Download your changed files or clear a folder.'
    : null;

const notify = () => {
  const m = message();
  listeners.forEach((l) => l(m));
};

export function subscribeWarning(cb: (msg: string | null) => void): () => void {
  listeners.add(cb);
  cb(message());
  return () => {
    listeners.delete(cb);
  };
}

export function flushSession(): void {
  if (timer !== undefined) {
    window.clearTimeout(timer);
    timer = undefined;
  }
  if (disabled) {
    pending.clear();
    return;
  }
  pending.forEach((value, key) => {
    try {
      sessionStorage.setItem(PREFIX + key, JSON.stringify(value));
      failed.delete(key);
    } catch {
      failed.add(key);
      try {
        sessionStorage.removeItem(PREFIX + key); // never leave a stale copy behind
      } catch {
        /* ignore */
      }
    }
  });
  pending.clear();
  notify();
}

export function saveSession(key: string, value: unknown): void {
  if (disabled) return;
  pending.set(key, value);
  if (timer === undefined) timer = window.setTimeout(flushSession, DELAY);
}

export function loadSession<T>(key: string, fallback: T): T {
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

/** Removes everything this app stored. Call location.reload() afterwards. */
export function clearSession(): void {
  disabled = true;
  pending.clear();
  failed.clear();
  try {
    const drop: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(PREFIX)) drop.push(k);
    }
    drop.forEach((k) => sessionStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}

export function usePersistentState<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => loadSession<T>(key, initial));
  useEffect(() => {
    saveSession(key, value);
  }, [key, value]);
  return [value, setValue];
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushSession);
  window.addEventListener('beforeunload', flushSession);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSession();
  });
}