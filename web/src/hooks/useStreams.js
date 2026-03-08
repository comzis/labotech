import { useState, useEffect, useCallback } from 'react';
import { getStreams, getTranscoders } from '../api';

const POLL_INTERVAL = 5000;

export default function useStreams() {
  const [streams,     setStreams]     = useState([]);
  const [transcoders, setTranscoders] = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState(null);

  const refresh = useCallback(async () => {
    try {
      const [s, t] = await Promise.all([getStreams(), getTranscoders()]);
      setStreams(s);
      setTranscoders(t);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [refresh]);

  return { streams, transcoders, loading, error, refresh };
}
