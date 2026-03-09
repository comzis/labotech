import { useState, useCallback } from 'react';
import { startETR290, stopETR290 } from '../api';

export default function useETR290() {
  const [status,   setStatus]   = useState(null);   // latest ETR290 status object
  const [activeId, setActiveId] = useState(null);
  const [error,    setError]    = useState(null);

  const start = useCallback(async (id, url) => {
    setError(null);
    try {
      const s = await startETR290({ id, url });
      setActiveId(id);
      setStatus(s);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  const stop = useCallback(async () => {
    if (!activeId) return;
    try {
      await stopETR290(activeId);
      setActiveId(null);
    } catch (err) {
      setError(err.message);
    }
  }, [activeId]);

  // Called from parent with each WS message
  const onWsMessage = useCallback((msg) => {
    if (!msg) return;
    if ((msg.type === 'etr290_status' || msg.type === 'etr290_alarm') && msg.id === activeId) {
      setStatus(prev => ({
        ...(prev || {}),
        ...msg,
        recentAlarms: msg.recentAlarms || prev?.recentAlarms || [],
      }));
    }
    if (msg.type === 'etr290_stopped' && msg.id === activeId) {
      setActiveId(null);
    }
  }, [activeId]);

  return { status, activeId, error, start, stop, onWsMessage };
}
