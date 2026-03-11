import { useState, useCallback } from 'react';
import { probeUrl, getAnalysers, startAnalyser, stopAnalyser } from '../api';

export default function useTSAnalysis() {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activeIds, setActiveIds] = useState([]);
  const [resultsById, setResultsById] = useState({});
  const [decoderMeta, setDecoderMeta] = useState({});

  const probe = useCallback(async (url) => {
    setLoading(true);
    setError(null);
    try {
      const r = await probeUrl(url);
      setResult(r);
      return r;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshActives = useCallback(async () => {
    try {
      const analysers = await getAnalysers();
      const runningIds = analysers.filter(a => a.isRunning).map(a => a.id);
      setActiveIds(runningIds);
      const meta = {};
      const restored = {};
      analysers.forEach(a => {
        meta[a.id] = { id: a.id, url: a.url, isRunning: a.isRunning };
        if (a.lastResult) {
          restored[a.id] = { id: a.id, ...a.lastResult };
        }
      });
      setDecoderMeta(meta);
      if (Object.keys(restored).length > 0) {
        setResultsById(prev => ({ ...prev, ...restored }));
      }
    } catch (_) {}
  }, []);

  const startContinuous = useCallback(async (id, url, interval, nicName) => {
    setError(null);
    try {
      await startAnalyser({ id, url, interval, ...(nicName ? { nicName } : {}) });
      setActiveIds(ids => (ids.includes(id) ? ids : [...ids, id]));
      setDecoderMeta(prev => ({ ...prev, [id]: { id, url, isRunning: true } }));
    } catch (err) {
      setError(err.message);
      throw err;
    }
  }, []);

  const stop = useCallback(async (id) => {
    if (!id) return;
    try {
      await stopAnalyser(id);
      setActiveIds(ids => ids.filter(v => v !== id));
      setResultsById(m => {
        const next = { ...m };
        delete next[id];
        return next;
      });
      setDecoderMeta(m => {
        const next = { ...m };
        delete next[id];
        return next;
      });
      setResult(prev => (prev && prev.id === id ? null : prev));
    } catch (err) {
      setError(err.message);
    }
  }, []);

  // Called from WS messages
  const onWsResult = useCallback((msg) => {
    if (msg.type === 'analyse_result' && msg.id) {
      setResultsById(prev => ({ ...prev, [msg.id]: msg }));
      setResult(msg);
      setActiveIds(ids => (ids.includes(msg.id) ? ids : [...ids, msg.id]));
      setDecoderMeta(prev => ({ ...prev, [msg.id]: { ...(prev[msg.id] || {}), id: msg.id, url: msg.url, isRunning: true } }));
    }
  }, []);

  return {
    result,
    loading,
    error,
    activeIds,
    resultsById,
    decoderMeta,
    probe,
    refreshActives,
    startContinuous,
    stop,
    onWsResult,
  };
}
