import React, { useState, useEffect } from 'react';
import { getMulticastConfig, getForwarders, startForwarder, stopForwarder } from '../api';
import StatusDot from './StatusDot';
import MetricsTile from './MetricsTile';

const DEFAULTS = {
  id:        '',
  sourceUrl: '',
  destIp:    '',
  destPort:  '1234',
};

export default function MulticastPanel({ lastMessage }) {
  const [config,     setConfig]     = useState(null);
  const [forwarders, setForwarders] = useState([]);
  const [form,       setForm]       = useState(DEFAULTS);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState(null);
  const [open,       setOpen]       = useState(false);

  const load = async () => {
    const [cfg, fwds] = await Promise.all([getMulticastConfig(), getForwarders()]);
    setConfig(cfg);
    setForwarders(fwds);
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (lastMessage?.type === 'multicast_stopped') load();
  }, [lastMessage]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await startForwarder({ ...form, destPort: parseInt(form.destPort) });
      setForm(DEFAULTS);
      setOpen(false);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleStop = async (id) => {
    await stopForwarder(id);
    load();
  };

  return (
    <div className="space-y-6">
      {/* Config badge */}
      {config && (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-sm grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            ['NIC',    config.nic],
            ['Subnet', config.subnet],
            ['Default IP', config.address],
            ['TTL',    config.ttl],
          ].map(([k, v]) => (
            <div key={k}>
              <div className="text-xs text-gray-600">{k}</div>
              <div className="font-mono text-green-400">{v}</div>
            </div>
          ))}
        </div>
      )}

      {/* Start form */}
      <div>
        <button
          onClick={() => setOpen(o => !o)}
          className="bg-green-700 hover:bg-green-600 text-white text-sm px-4 py-2 rounded transition-colors"
        >
          {open ? '✕ Cancel' : '+ Start Forwarder'}
        </button>

        {open && (
          <form onSubmit={handleSubmit} className="mt-4 bg-gray-900 border border-gray-800 rounded-lg p-5 grid grid-cols-2 md:grid-cols-3 gap-4">
            {[
              ['Forwarder ID *', 'id'],
              ['Source URL *',   'sourceUrl'],
              ['Dest IP *',      'destIp'],
              ['Dest Port',      'destPort'],
            ].map(([label, key]) => (
              <div key={key}>
                <label className="block text-xs text-gray-500 mb-1">{label}</label>
                <input
                  value={form[key]}
                  onChange={e => set(key, e.target.value)}
                  required={label.endsWith('*')}
                  placeholder={key === 'destIp' ? '239.100.25.x' : key === 'sourceUrl' ? 'udp://239.x.x.x:port' : ''}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-green-600"
                />
              </div>
            ))}
            {error && <p className="col-span-full text-red-400 text-sm">{error}</p>}
            <div className="col-span-full">
              <button
                type="submit"
                disabled={loading}
                className="bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-sm px-4 py-2 rounded"
              >
                {loading ? 'Starting…' : 'Start'}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Active forwarders */}
      <section>
        <h2 className="text-sm text-gray-400 mb-3 uppercase tracking-widest">
          Active Forwarders ({forwarders.length})
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {forwarders.map(f => (
            <div key={f.id} className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <StatusDot status={f.isRunning ? 'live' : 'stopped'} pulse />
                  <span className="font-mono text-sm font-semibold">{f.id}</span>
                </div>
                {f.isRunning && (
                  <button
                    onClick={() => handleStop(f.id)}
                    className="text-xs bg-red-900 hover:bg-red-800 text-red-300 px-2 py-1 rounded"
                  >
                    Stop
                  </button>
                )}
              </div>
              <div className="text-xs text-gray-500">{f.sourceUrl} → {f.destIp}:{f.destPort}</div>
              {f.isRunning && <MetricsTile id={f.id} stats={f.lastStats} lastMessage={lastMessage} />}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
