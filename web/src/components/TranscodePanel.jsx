import React, { useState, useEffect } from 'react';
import { getPresets, getBroadcastPresets, getTranscoders, startTranscoder, stopTranscoder } from '../api';
import StatusDot from './StatusDot';
import MetricsTile from './MetricsTile';
import { Zap, Activity, Settings2, Play, Tv2 } from 'lucide-react';

const DEFAULTS = {
  id: '',
  input: '',
  host: '',
  port: '9999',
  transcodePreset: 'pal',
  broadcastPresetSlot: '',
  videoBitrate: '',
  audioBitrate: '',
  passphrase: '',
};

export default function TranscodePanel({ lastMessage }) {
  const [presets, setPresets] = useState([]);
  const [broadcastPresets, setBroadcastPresets] = useState([]);
  const [transcoders, setTranscoders] = useState([]);
  const [form, setForm] = useState(DEFAULTS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(false);

  const load = async () => {
    try {
      const [p, bp, t] = await Promise.all([
        getPresets(),
        getBroadcastPresets(),
        getTranscoders()
      ]);
      setPresets(p);
      setBroadcastPresets(bp);
      setTranscoders(t);
    } catch (err) {
      console.error('Failed to load transcoder data:', err);
    }
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
      const payload = { ...form, port: parseInt(form.port) };
      if (payload.broadcastPresetSlot) payload.broadcastPresetSlot = parseInt(payload.broadcastPresetSlot);

      await startTranscoder(payload);
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
    <div className="space-y-8 font-sans">
      {/* Start form Toggle */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
            <Activity className="w-6 h-6 text-neon-purple" strokeWidth={1.5} />
            Transcode Engine
          </h1>
          <p className="text-xs text-gray-500 mt-1 uppercase tracking-widest">Global Frame Transformation & Normalization</p>
        </div>
        <button
          onClick={() => setOpen(o => !o)}
          className={`flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold transition-all ${open
            ? 'bg-gray-800 text-gray-400 hover:text-white border border-white/10'
            : 'bg-gradient-to-r from-neon-purple to-purple-600 text-white shadow-lg shadow-neon-purple/20 hover:shadow-neon-purple/40'
            }`}
        >
          {open ? '✕ Cancel' : <><Zap className="w-4 h-4 fill-current" /> Deploy Transcoder</>}
        </button>
      </div>

      {open && (
        <form onSubmit={handleSubmit} className="bg-midnight-glass border border-white/5 backdrop-blur-xl rounded-2xl p-6 shadow-2xl relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 relative z-10">
            {/* Step 1: Transformation */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <Settings2 className="w-4 h-4 text-neon-cyan" />
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest">1. Transformation</h3>
              </div>
              <div className="grid grid-cols-1 gap-2">
                {presets.map(p => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => set('transcodePreset', p.key)}
                    className={`text-left px-4 py-3 rounded-xl border transition-all ${form.transcodePreset === p.key
                      ? 'bg-neon-purple/20 border-neon-purple/50 text-white ring-1 ring-neon-purple/50'
                      : 'bg-black/30 border-white/10 text-gray-500 hover:border-white/20 hover:bg-black/40'
                      }`}
                  >
                    <div className="text-xs font-bold">{p.name}</div>
                    <div className="text-[10px] opacity-60 mt-1">
                      {p.inputFps} → {p.outputFps} fps • {p.interlaced ? 'Interlaced' : 'Progressive'}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Step 2: Output Format */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <Tv2 className="w-4 h-4 text-neon-purple" />
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest">2. Output Format</h3>
              </div>
              <select
                value={form.broadcastPresetSlot}
                onChange={e => set('broadcastPresetSlot', e.target.value)}
                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-gray-200 focus:outline-none focus:border-neon-purple/50 transition-all appearance-none cursor-pointer"
                style={{ backgroundImage: `url('data:image/svg+xml;utf8,<svg fill="%239ca3af" height="20" viewBox="0 0 24 24" width="20" xmlns="http://www.w3.org/2000/svg"><path d="M7 10l5 5 5-5z"/><path d="M0 0h24v24H0z" fill="none"/></svg>')`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center' }}
              >
                <option value="" className="bg-midnight-surface">Manual Configuration</option>
                {broadcastPresets.map(bp => (
                  <option key={bp.slot} value={bp.slot} className="bg-midnight-surface">
                    Slot {bp.slot}: {bp.name} ({bp.videoBitrate})
                  </option>
                ))}
              </select>

              <div className="grid grid-cols-2 gap-4">
                <Field label="Video Bitrate" placeholder="e.g. 8M" value={form.videoBitrate} onChange={v => set('videoBitrate', v)} />
                <Field label="Audio Bitrate" placeholder="e.g. 256k" value={form.audioBitrate} onChange={v => set('audioBitrate', v)} />
              </div>
              <p className="text-[10px] text-gray-500 italic">Leave bitrates empty to use preset defaults.</p>
            </div>

            {/* Step 3: Destination */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <Play className="w-4 h-4 text-neon-green" />
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest">3. Destination</h3>
              </div>
              <div className="space-y-4">
                <Field label="Stream ID *" placeholder="channel-1-transcoded" value={form.id} onChange={v => set('id', v)} required />
                <Field label="Input Source *" placeholder="udp://239.0.0.1:5000" value={form.input} onChange={v => set('input', v)} required />
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Target Host *" placeholder="10.67.18.30" value={form.host} onChange={v => set('host', v)} required />
                  <Field label="Port *" value={form.port} onChange={v => set('port', v)} type="number" required />
                </div>
              </div>
            </div>
          </div>

          {error && <p className="mt-6 text-red-400 text-sm bg-red-900/20 border border-red-900/50 p-3 rounded-lg">{error}</p>}

          <div className="mt-8 flex justify-end">
            <button
              type="submit"
              disabled={loading}
              className="bg-gradient-to-r from-neon-purple to-purple-600 text-white font-bold px-10 py-3 rounded-xl shadow-lg hover:shadow-neon-purple/40 transition-all disabled:opacity-50"
            >
              {loading ? 'Initializing Engine...' : 'INITIATE TRANSCODE'}
            </button>
          </div>
        </form>
      )}

      {/* Active transcoders Section */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm text-gray-400 uppercase tracking-widest font-bold">
            Running Pipelines ({transcoders.length})
          </h2>
        </div>
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

function Field({ label, value, onChange, ...props }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider pl-1">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        {...props}
        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-gray-200 focus:outline-none focus:border-neon-purple/50 focus:bg-neon-purple/5 transition-all placeholder:text-gray-600"
      />
    </div>
  );
}
