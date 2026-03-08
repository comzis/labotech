import { useState, useEffect, useRef, useCallback } from 'react';

const WS_URL = `ws://${window.location.host}`;
const MAX_RETRIES = 5;
const RETRY_DELAY = 3000;

export default function useWebSocket() {
  const [connected, setConnected]       = useState(false);
  const [lastMessage, setLastMessage]   = useState(null);
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
      try {
        setLastMessage(JSON.parse(evt.data));
      } catch (_) {}
    };

    ws.onclose = () => {
      setConnected(false);
      if (retries.current < MAX_RETRIES) {
        retries.current++;
        timerRef.current = setTimeout(connect, RETRY_DELAY);
      }
    };

    ws.onerror = () => {
      ws.close();
    };
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
