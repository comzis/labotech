import { useState, useCallback } from 'react';
import { startETR290, stopETR290, getETR290Monitors } from '../api';

export default function useETR290() {
  const [statusById, setStatusById] = useState({});
  const [activeId, setActiveId] = useState(null);
  const [activeIds, setActiveIds] = useState([]);
  const [error,    setError]    = useState(null);

  const start = useCallback(async (id, url) => {
    setError(null);
    try {
      const s = await startETR290({ id, url });
      setStatusById(prev => ({ ...prev, [id]: s }));
      setActiveIds(prev => (prev.includes(id) ? prev : [...prev, id]));
      setActiveId(id);
      return s;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  }, []);

  const stop = useCallback(async (id = activeId) => {
    if (!id) return;
    try {
      await stopETR290(id);
      setActiveIds(prev => prev.filter(v => v !== id));
      setStatusById(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      if (id === activeId) setActiveId(null);
    } catch (err) {
      setError(err.message);
      throw err;
    }
  }, [activeId]);

  const refreshActives = useCallback(async () => {
    try {
      const mons = await getETR290Monitors();
      const ids = mons.filter(m => m.isRunning).map(m => m.id);
      const nextById = {};
      mons.forEach(m => {
        if (m.isRunning) nextById[m.id] = m;
      });
      setActiveIds(ids);
      setStatusById(prev => ({ ...prev, ...nextById }));
      if (ids.length > 0 && !ids.includes(activeId)) {
        setActiveId(ids[0]);
      }
      if (ids.length === 0) setActiveId(null);
    } catch (err) {
      setError(err.message);
    }
  }, [activeId]);

  // Called from parent with each WS message
  const onWsMessage = useCallback((msg) => {
    if (!msg) return;
    if ((msg.type === 'etr290_status' || msg.type === 'etr290_alarm') && msg.id) {
      setStatusById(prev => ({
        ...prev,
        [msg.id]: {
          ...(prev[msg.id] || {}),
        ...msg,
          recentAlarms: msg.recentAlarms || prev[msg.id]?.recentAlarms || [],
        },
      }));
      setActiveIds(prev => (prev.includes(msg.id) ? prev : [...prev, msg.id]));
      if (!activeId) setActiveId(msg.id);
    }
    if (msg.type === 'etr290_stopped' && msg.id) {
      setActiveIds(prev => prev.filter(v => v !== msg.id));
      setStatusById(prev => {
        const next = { ...prev };
        delete next[msg.id];
        return next;
      });
      if (msg.id === activeId) setActiveId(null);
    }
  }, [activeId]);

  const status = activeId ? (statusById[activeId] || null) : null;
  return {
    status,
    statusById,
    activeId,
    activeIds,
    error,
    start,
    stop,
    setActiveId,
    refreshActives,
    onWsMessage,
  };
}
