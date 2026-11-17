import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { api, type WaStatus } from './api';

let socket: Socket | null = null;
export function getSocket() {
  if (!socket) socket = io({ transports: ['websocket', 'polling'] });
  return socket;
}

/** Subscribes to a Socket.IO event for the component's lifetime. */
export function useSocketEvent<T = any>(event: string, handler: (payload: T) => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const s = getSocket();
    const fn = (p: T) => ref.current(p);
    s.on(event, fn);
    return () => {
      s.off(event, fn);
    };
  }, [event]);
}

/**
 * GETs `path` and re-fetches when any of `liveEvents` fire (debounced),
 * so pages update live while a campaign is sending.
 */
export function useApi<T>(path: string | null, liveEvents: string[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const pathRef = useRef(path);
  pathRef.current = path;

  const reload = useCallback(async () => {
    const p = pathRef.current;
    if (!p) return;
    try {
      const d = await api<T>(p);
      if (pathRef.current === p) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void reload();
  }, [path, reload]);

  useEffect(() => {
    if (!liveEvents.length) return;
    const s = getSocket();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const fn = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        void reload();
      }, 700);
    };
    liveEvents.forEach((e) => s.on(e, fn));
    return () => {
      liveEvents.forEach((e) => s.off(e, fn));
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveEvents.join(','), reload]);

  return { data, error, loading, reload, setData };
}

export function useWaStatus() {
  const [status, setStatus] = useState<WaStatus>({ state: 'disconnected', qr: null, me: null, error: null });
  useEffect(() => {
    api<WaStatus>('/wa/status').then(setStatus).catch(() => {});
  }, []);
  useSocketEvent<WaStatus>('wa:status', setStatus);
  return status;
}

/** Re-renders every `ms` so relative times ("in 3 min") stay fresh. */
export function useNow(ms = 15000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
