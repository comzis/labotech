import { useState, useEffect, useRef, useCallback } from 'react';

const WS_URL       = `ws://${window.location.host}`;
const BASE_DELAY   = 1000;   // 1s initial backoff
const MAX_DELAY    = 30000;  // 30s ceiling — broadcast servers must always reconnect

export default function useWebSocket() {
  const [connected,    setConnected]   = useState(false);
  const [lastMessage,  setLastMessage] = useState(null);
  const wsRef    = useRef(null);
  const retries  = useRef(0);
  const timerRef = useRef(null);

  const connect = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      retries.current = 0;
    };

    ws.onmessage = (evt) => {
      try { setLastMessage(JSON.parse(evt.data)); } catch (_) {}
    };

    ws.onclose = () => {
      setConnected(false);
      // Exponential backoff — never give up (broadcast server may restart)
      const delay = Math.min(BASE_DELAY * Math.pow(1.5, retries.current), MAX_DELAY);
      retries.current++;
      timerRef.current = setTimeout(connect, delay);
    };

    ws.onerror = () => ws.close();
  }, []);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(timerRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [connect]);

  return { connected, lastMessage };
}
