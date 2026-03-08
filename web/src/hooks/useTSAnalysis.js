import { useState, useCallback } from 'react';
import { probeUrl, startAnalyser, stopAnalyser } from '../api';

export default function useTSAnalysis() {
  const [result,   setResult]   = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);
  const [activeId, setActiveId] = useState(null);

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

  const startContinuous = useCallback(async (id, url, interval) => {
    setError(null);
    try {
      await startAnalyser({ id, url, interval });
      setActiveId(id);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  const stop = useCallback(async () => {
    if (!activeId) return;
    try {
      await stopAnalyser(activeId);
      setActiveId(null);
    } catch (err) {
      setError(err.message);
    }
  }, [activeId]);

  // Called from WS messages
  const onWsResult = useCallback((msg) => {
    if (msg.type === 'analyse_result') {
      setResult(msg);
    }
  }, []);

  return { result, loading, error, activeId, probe, startContinuous, stop, onWsResult };
}
