import { useState, useCallback, useRef } from 'react';
import { probeUrl, getAnalysers, startAnalyser, stopAnalyser } from '../api';

const STOP_SUPPRESS_MS = 12000;

function hasUsableAudioSample(audioLevels) {
  if (!audioLevels || typeof audioLevels !== 'object') return false;
  const channels = Array.isArray(audioLevels.channels) ? audioLevels.channels : [];
  if (channels.length > 0) return true;
  const meanDb = Number(audioLevels.meanDb);
  if (Number.isFinite(meanDb)) return true;
  const maxDb = Number(audioLevels.maxDb);
  return Number.isFinite(maxDb);
}

function mergeWithAudioCarry(previousResult, incomingResult) {
  const previousAudio = previousResult && previousResult.audioLevels;
  const incomingAudio = incomingResult && incomingResult.audioLevels;
  if (hasUsableAudioSample(incomingAudio) || !hasUsableAudioSample(previousAudio)) {
    return incomingResult;
  }
  return {
    ...incomingResult,
    audioLevels: previousAudio,
  };
}

export default function useTSAnalysis() {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activeIds, setActiveIds] = useState([]);
  const [resultsById, setResultsById] = useState({});
  const [decoderMeta, setDecoderMeta] = useState({});
  const stopSuppressedUntilRef = useRef(new Map());
  const refreshInFlightRef = useRef(null);

  const cleanupSuppression = useCallback(() => {
    const now = Date.now();
    for (const [id, untilTs] of stopSuppressedUntilRef.current.entries()) {
      if (!Number.isFinite(untilTs) || untilTs <= now) stopSuppressedUntilRef.current.delete(id);
    }
  }, []);

  const isSuppressed = useCallback((id) => {
    cleanupSuppression();
    const untilTs = stopSuppressedUntilRef.current.get(id);
    return Number.isFinite(untilTs) && untilTs > Date.now();
  }, [cleanupSuppression]);

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
    if (refreshInFlightRef.current) return refreshInFlightRef.current;
    refreshInFlightRef.current = (async () => {
      try {
        cleanupSuppression();
        const analysers = await getAnalysers();
        const runningIds = analysers
          .filter((a) => a.isRunning)
          .map((a) => a.id)
          .filter((id) => !isSuppressed(id));
        setActiveIds(runningIds);
        const meta = {};
        const restored = {};
        analysers.forEach(a => {
          if (isSuppressed(a.id)) return;
          meta[a.id] = { id: a.id, url: a.url, isRunning: a.isRunning };
          if (a.lastResult) {
            restored[a.id] = { id: a.id, ...a.lastResult };
          }
        });
        setDecoderMeta(meta);
        if (Object.keys(restored).length > 0) {
          setResultsById((prev) => {
            const next = { ...prev };
            Object.entries(restored).forEach(([id, restoredResult]) => {
              next[id] = mergeWithAudioCarry(prev[id], restoredResult);
            });
            return next;
          });
        }
      } catch (_) {}
      finally {
        refreshInFlightRef.current = null;
      }
    })();
    return refreshInFlightRef.current;
  }, [cleanupSuppression, isSuppressed]);

  const startContinuous = useCallback(async (id, url, interval, nicName) => {
    setError(null);
    try {
      await startAnalyser({ id, url, interval, ...(nicName ? { nicName } : {}) });
      stopSuppressedUntilRef.current.delete(id);
      setActiveIds(ids => (ids.includes(id) ? ids : [...ids, id]));
      setDecoderMeta(prev => ({ ...prev, [id]: { id, url, isRunning: true } }));
    } catch (err) {
      setError(err.message);
      throw err;
    }
  }, []);

  const stop = useCallback(async (id) => {
    if (!id) return;
    stopSuppressedUntilRef.current.set(id, Date.now() + STOP_SUPPRESS_MS);
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
      throw err;
    }
  }, []);

  // Called from WS messages
  const onWsResult = useCallback((msg) => {
    if (!msg || !msg.type || !msg.id) return;
    // Keep Multiview thumbnails "live" by updating the per-tile src as soon as
    // the backend worker emits a new `thumbnail_frame`.
    if (msg.type === 'thumbnail_frame') {
      if (isSuppressed(msg.id)) return;
      // Worker sends the generated JPEG file path as `msg.path`.
      // `msg.url` is the *input stream URL* (not the thumbnail image URL), so
      // we must build the `/logs/thumbnails/<file>.jpg?t=...` URL ourselves.
      const filePath = typeof msg.path === 'string' ? msg.path.trim() : '';
      if (!filePath) return;
      const baseName = filePath.split('/').pop();
      if (!baseName) return;
      const id = msg.id;
      const now = Date.now();
      const thumbUrl = `/logs/thumbnails/${baseName}?t=${now}`;
      setResultsById((prev) => {
        // Do not create/revive decoders from thumbnail-only messages.
        // A stopped decoder can emit a trailing frame while teardown settles;
        // re-adding it here causes "ghost" tiles to return after stop.
        if (!prev[id]) return prev;
        const next = { ...prev };
        const existing = next[id];
        next[id] = { ...existing, thumbnailUrl: thumbUrl };
        return next;
      });
      return;
    }
    if (msg.type === 'analyse_result') {
      if (isSuppressed(msg.id)) return;
      setResultsById((prev) => ({
        ...prev,
        [msg.id]: mergeWithAudioCarry(prev[msg.id], msg),
      }));
      // Do NOT call setResult(msg) here — that global state is only for one-shot
      // probe() calls. Unconditionally updating it from any WS message causes
      // cross-contamination when multiple decoders are active simultaneously.
      setActiveIds(ids => (ids.includes(msg.id) ? ids : [...ids, msg.id]));
      setDecoderMeta(prev => ({ ...prev, [msg.id]: { ...(prev[msg.id] || {}), id: msg.id, url: msg.url, isRunning: true } }));
      return;
    }
    if (msg.type === 'analyse_stopped') {
      stopSuppressedUntilRef.current.set(msg.id, Date.now() + STOP_SUPPRESS_MS);
      setActiveIds((ids) => ids.filter((v) => v !== msg.id));
      setResultsById((m) => {
        const next = { ...m };
        delete next[msg.id];
        return next;
      });
      setDecoderMeta((m) => {
        const next = { ...m };
        delete next[msg.id];
        return next;
      });
      return;
    }
    if (msg.type === 'analyse_started') {
      stopSuppressedUntilRef.current.delete(msg.id);
      setActiveIds(ids => (ids.includes(msg.id) ? ids : [...ids, msg.id]));
      return;
    }
    // Propagate probe errors so tiles show a failure state rather than waiting forever.
    if (msg.type === 'error' && msg.id) {
      if (isSuppressed(msg.id)) return;
      setResultsById((prev) => {
        if (prev[msg.id]) return prev; // already have data; don't overwrite with error
        return { ...prev, [msg.id]: { ...(prev[msg.id] || {}), id: msg.id, probeError: msg.message || 'probe failed', probeTime: null } };
      });
      return;
    }
  }, [isSuppressed]);

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
