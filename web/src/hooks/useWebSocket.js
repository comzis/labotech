import { useState, useEffect, useRef, useCallback } from 'react';

const WS_URL       = import.meta.env.DEV
  ? 'ws://127.0.0.1:4000'
  : `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`;
const BASE_DELAY   = 1000;   // 1s initial backoff
const MAX_DELAY    = 30000;  // 30s ceiling — broadcast servers must always reconnect

export default function useWebSocket() {
  const [connected,    setConnected]   = useState(false);
  const [lastMessage,  setLastMessage] = useState(null);
  const wsRef    = useRef(null);
  const retries  = useRef(0);
  const timerRef = useRef(null);
  const activeRef = useRef(true);

  const connect = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      retries.current = 0;
    };

    ws.onmessage = async (evt) => {
      let raw = evt?.data;
      if (raw == null) return;
      if (typeof raw !== 'string') {
        try {
          raw = await raw.text();
        } catch (_) {
          return;
        }
      }
      if (!raw) return;

      const emitParsed = (value) => {
        if (!value) return;
        if (Array.isArray(value)) {
          value.forEach(emitParsed);
          return;
        }
        if (typeof value === 'object') {
          setLastMessage(value);
        }
      };

      try {
        emitParsed(JSON.parse(raw));
        return;
      } catch (_) {
        // Some proxies can batch newline-delimited JSON payloads.
      }

      const lines = raw.split('\n').map((s) => s.trim()).filter(Boolean);
      if (lines.length === 0) return;
      for (const line of lines) {
        try {
          emitParsed(JSON.parse(line));
        } catch (_) {
          // Ignore malformed payload fragments; keep connection alive.
        }
      }
    };

    ws.onclose = () => {
      setConnected(false);
      if (!activeRef.current) return;
      // Exponential backoff — never give up (broadcast server may restart)
      const delay = Math.min(BASE_DELAY * Math.pow(1.5, retries.current), MAX_DELAY);
      retries.current++;
      timerRef.current = setTimeout(connect, delay);
    };

    ws.onerror = () => ws.close();
  }, []);

  useEffect(() => {
    activeRef.current = true;
    connect();
    return () => {
      activeRef.current = false;
      clearTimeout(timerRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [connect]);

  return { connected, lastMessage };
}
