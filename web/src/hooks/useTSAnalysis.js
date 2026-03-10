import { useState, useCallback } from 'react';
import { probeUrl, getAnalysers, startAnalyser, stopAnalyser } from '../api';

export default function useTSAnalysis() {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activeIds, setActiveIds] = useState([]);
  const [resultsById, setResultsById] = useState({});

  const probe = useCallback(async (url) => {
    setLoading(true);
    setError(null);
    try {
      const r = await probeUrl(url);
      setResult(r);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshActives = useCallback(async () => {
    try {
      const analysers = await getAnalysers();
      const runningIds = analysers.filter(a => a.isRunning).map(a => a.id);
      setActiveIds(runningIds);
    } catch (_) {}
  }, []);

  const startContinuous = useCallback(async (id, url, interval) => {
    setError(null);
    try {
      await startAnalyser({ id, url, interval });
      setActiveIds(ids => (ids.includes(id) ? ids : [...ids, id]));
    } catch (err) {
      setError(err.message);
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
    }
  }, []);

  return {
    result,
    loading,
    error,
    activeIds,
    resultsById,
    probe,
    refreshActives,
    startContinuous,
    stop,
    onWsResult,
  };
}
