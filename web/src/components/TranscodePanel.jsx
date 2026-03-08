import React, { useState, useEffect } from 'react';
import { getPresets, getTranscoders, startTranscoder, stopTranscoder } from '../api';
import StatusDot from './StatusDot';
import MetricsTile from './MetricsTile';

const DEFAULTS = {
  id:              '',
  input:           '',
  host:            '',
  port:            '9999',
  transcodePreset: 'pal',
  videoBitrate:    '8M',
  audioBitrate:    '256k',
  passphrase:      '',
};

export default function TranscodePanel({ lastMessage }) {
  const [presets,     setPresets]     = useState([]);
  const [transcoders, setTranscoders] = useState([]);
  const [form,        setForm]        = useState(DEFAULTS);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState(null);
  const [open,        setOpen]        = useState(false);

  const load = async () => {
    const [p, t] = await Promise.all([getPresets(), getTranscoders()]);
    setPresets(p);
    setTranscoders(t);
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (lastMessage?.type === 'transcode_stopped') load();
  }, [lastMessage]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await startTranscoder({ ...form, port: parseInt(form.port) });
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
    await stopTranscoder(id);
    load();
  };

  return (
    <div className="space-y-6">
      {/* Preset reference */}
      <section>
        <h2 className="text-sm text-gray-400 mb-3 uppercase tracking-widest">Interlace Presets</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {presets.map(p => (
            <button
              key={p.key}
              onClick={() => { set('transcodePreset', p.key); setOpen(true); }}
              className="bg-gray-900 border border-gray-800 hover:border-purple-600 rounded-lg p-3 text-left transition-colors"
            >
              <div className="text-xs font-semibold text-purple-300">{p.name}</div>
              <div className="text-xs text-gray-600 mt-1">
                {p.inputFps} fps → {p.outputFps} fps {p.interlaced ? '(interlaced)' : '(progressive)'}
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* Start form */}
      <div>
        <button
          onClick={() => setOpen(o => !o)}
          className="bg-purple-700 hover:bg-purple-600 text-white text-sm px-4 py-2 rounded transition-colors"
        >
          {open ? '✕ Cancel' : '+ Start Transcoder'}
        </button>

        {open && (
          <form onSubmit={handleSubmit} className="mt-4 bg-gray-900 border border-gray-800 rounded-lg p-5 grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="col-span-full">
              <label className="block text-xs text-gray-500 mb-1">Transcode Preset</label>
              <div className="flex gap-2 flex-wrap">
                {presets.map(p => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => set('transcodePreset', p.key)}
                    className={`text-xs px-3 py-1.5 rounded border transition-colors ${
                      form.transcodePreset === p.key
                        ? 'bg-purple-700 border-purple-500 text-white'
                        : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-purple-600'
                    }`}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </div>

            {[
              ['Stream ID *', 'id'], ['Input URL *', 'input'],
              ['SRT Host *', 'host'], ['SRT Port', 'port'],
              ['Video Bitrate', 'videoBitrate'], ['Audio Bitrate', 'audioBitrate'],
            ].map(([label, key]) => (
              <div key={key}>
                <label className="block text-xs text-gray-500 mb-1">{label}</label>
                <input
                  value={form[key]}
                  onChange={e => set(key, e.target.value)}
                  required={label.endsWith('*')}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-600"
                />
              </div>
            ))}

            {error && <p className="col-span-full text-red-400 text-sm">{error}</p>}
            <div className="col-span-full">
              <button
                type="submit"
                disabled={loading}
                className="bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white text-sm px-4 py-2 rounded"
              >
                {loading ? 'Starting…' : 'Start'}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Active transcoders */}
      <section>
        <h2 className="text-sm text-gray-400 mb-3 uppercase tracking-widest">
          Active Transcoders ({transcoders.length})
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {transcoders.map(t => (
            <div key={t.id} className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <StatusDot status={t.isRunning ? 'live' : 'stopped'} pulse />
                  <span className="font-mono text-sm font-semibold">{t.id}</span>
                </div>
                {t.isRunning && (
                  <button
                    onClick={() => handleStop(t.id)}
                    className="text-xs bg-red-900 hover:bg-red-800 text-red-300 px-2 py-1 rounded"
                  >
                    Stop
                  </button>
                )}
              </div>
              <div className="text-xs text-purple-400">{t.presetName}</div>
              <div className="text-xs text-gray-500 truncate">{t.input}</div>
              {t.isRunning && <MetricsTile id={t.id} stats={t.lastStats} lastMessage={lastMessage} />}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
