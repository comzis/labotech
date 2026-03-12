import { useState, useCallback } from 'react';
import {
  startETR290,
  stopETR290,
  getETR290Monitors,
  updateETR290Config,
  getETR290Profiles,
  saveETR290Profile,
  deleteETR290Profile,
} from '../api';

export default function useETR290() {
  const [statusById, setStatusById] = useState({});
  const [activeId, setActiveId] = useState(null);
  const [activeIds, setActiveIds] = useState([]);
  const [error,    setError]    = useState(null);
  const [profiles, setProfiles] = useState([]);

  const start = useCallback(async (id, url, nicName, options = {}) => {
    setError(null);
    try {
      const payload = {
        id,
        url,
        ...(nicName ? { nicName } : {}),
        ...(options.profileName ? { profileName: options.profileName } : {}),
        ...(options.config ? { config: options.config } : {}),
      };
      const s = await startETR290(payload);
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

  const loadProfiles = useCallback(async () => {
    try {
      const rows = await getETR290Profiles();
      setProfiles(Array.isArray(rows) ? rows : []);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  const saveProfile = useCallback(async (name, config, description = '') => {
    const saved = await saveETR290Profile({ name, description, config });
    await loadProfiles();
    return saved;
  }, [loadProfiles]);

  const deleteProfile = useCallback(async (name) => {
    await deleteETR290Profile(name);
    await loadProfiles();
  }, [loadProfiles]);

  const updateConfig = useCallback(async (id, config, profileName = null) => {
    const updated = await updateETR290Config(id, {
      config,
      ...(profileName ? { profileName } : {}),
    });
    setStatusById(prev => ({ ...prev, [id]: updated }));
    return updated;
  }, []);

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
    profiles,
    error,
    start,
    stop,
    setActiveId,
    refreshActives,
    onWsMessage,
    loadProfiles,
    saveProfile,
    deleteProfile,
    updateConfig,
  };
}
