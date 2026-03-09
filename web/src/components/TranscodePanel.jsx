import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Zap, Activity, Settings2, Play, Tv2, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import BentoCard, { containerVariants } from './ui/BentoCard';
import { Field } from './ui/MatrixField';
import { getPresets, getBroadcastPresets, getTranscoders, startTranscoder, stopTranscoder } from '../api';
import StatusDot from './StatusDot';
import MetricsTile from './MetricsTile';

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

// Framer Motion Animation Variants (Same as EncoderForm)
// Animations moved to BentoCard.jsx

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

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (lastMessage?.type === 'transcode_stopped' || lastMessage?.type === 'error') load();
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
    try {
      await stopTranscoder(id);
    } catch (err) {
      // 404 = already gone (server restart etc.) — just refresh silently
      if (!err.message.includes('404') && !err.message.toLowerCase().includes('not found')) {
        toast.error(`Stop failed: ${err.message}`);
      }
    }
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
          <p className="text-xs text-gray-500 mt-1 uppercase tracking-widest font-medium opacity-80">Global Frame Transformation & Normalization</p>
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
        <motion.form
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          onSubmit={handleSubmit}
          className="relative"
        >
          <motion.div variants={containerVariants} initial="hidden" animate="show" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">

            {/* Step 1: Transformation Matrix */}
            <BentoCard icon={Settings2} title="1. Transformation Matrix" className="border-neon-cyan/20 bg-neon-cyan/5">
              <div className="grid grid-cols-1 gap-2">
                {presets.map(p => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => set('transcodePreset', p.key)}
                    className={`text-left px-4 py-3 rounded-xl border transition-all ${form.transcodePreset === p.key
                      ? 'bg-neon-cyan/20 border-neon-cyan/50 text-white ring-1 ring-neon-cyan/50'
                      : 'bg-black/30 border-white/10 text-gray-500 hover:border-white/20 hover:bg-black/40'
                      }`}
                  >
                    <div className="text-xs font-bold">{p.name}</div>
                    <div className="text-[10px] opacity-60 mt-1 uppercase tracking-tighter font-semibold">
                      {p.inputFps} → {p.outputFps} FPS • {p.interlaced ? 'Interlaced' : 'Progressive'}
                    </div>
                  </button>
                ))}
              </div>
            </BentoCard>

            {/* Step 2: Format Matrix */}
            <BentoCard icon={Tv2} title="2. Format Matrix" className="border-neon-purple/20 bg-neon-purple/5">
              <div className="space-y-4">
                <div>
                  <label className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider pl-1 mb-1.5 block">Preset Slot</label>
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
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <Field label="Video Bitrate" placeholder="e.g. 8M" value={form.videoBitrate} onChange={v => set('videoBitrate', v)} color="purple" />
                  <Field label="Audio Bitrate" placeholder="e.g. 256k" value={form.audioBitrate} onChange={v => set('audioBitrate', v)} color="purple" />
                </div>
                <p className="text-[10px] text-gray-500 italic opacity-70">Leave bitrates empty to use preset defaults.</p>
              </div>
            </BentoCard>

            {/* Step 3: Destination Matrix */}
            <BentoCard icon={Share2} title="3. Destination Matrix" className="border-neon-green/20 bg-neon-green/5">
              <div className="space-y-4">
                <Field label="Stream ID *" placeholder="channel-1-transcoded" value={form.id} onChange={v => set('id', v)} required color="green" />
                <Field label="Input Source *" placeholder="udp://239.0.0.1:5000" value={form.input} onChange={v => set('input', v)} required color="green" />
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Target Host *" placeholder="10.67.18.29" value={form.host} onChange={v => set('host', v)} required color="green" />
                  <Field label="Port *" value={form.port} onChange={v => set('port', v)} type="number" required color="green" />
                </div>
              </div>
            </BentoCard>
          </motion.div>

          {error && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-6 bg-red-950/50 border border-red-500/50 text-red-200 p-4 rounded-xl flex items-center gap-3 backdrop-blur-md">
              <p className="text-sm font-medium">{error}</p>
            </motion.div>
          )}

          <div className="mt-8 flex justify-end">
            <motion.button
              whileHover={{ scale: 1.05, boxShadow: '0 0 25px rgba(168,85,247,0.4)' }}
              whileTap={{ scale: 0.95 }}
              type="submit"
              disabled={loading}
              className="bg-gradient-to-r from-neon-purple to-purple-600 text-white font-bold px-10 py-3 rounded-xl shadow-lg hover:shadow-neon-purple/40 transition-all disabled:opacity-50"
            >
              {loading ? 'Initializing Matrix...' : 'INITIATE TRANSCODE'}
            </motion.button>
          </div>
        </motion.form>
      )}

      {/* Active transcoders Section */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm text-gray-400 uppercase tracking-widest font-bold opacity-80">
            Running Pipelines ({transcoders.length})
          </h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {transcoders.map(t => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-midnight-glass border border-white/5 backdrop-blur-xl rounded-2xl p-4 space-y-3 relative overflow-hidden group"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
              <div className="flex items-center justify-between relative z-10">
                <div className="flex items-center gap-2">
                  <StatusDot status={t.isRunning ? 'live' : 'stopped'} pulse />
                  <span className="font-mono text-sm font-semibold text-gray-200">{t.id}</span>
                </div>
                {t.isRunning && (
                  <button
                    onClick={() => handleStop(t.id)}
                    className="text-[10px] font-bold uppercase tracking-tighter bg-red-900/40 hover:bg-red-800/60 text-red-300 px-2 py-1 rounded-md border border-red-500/20 transition-colors"
                  >
                    Terminate
                  </button>
                )}
              </div>
              <div className="text-xs font-bold text-neon-purple/80 uppercase tracking-wide relative z-10">{t.presetName}</div>
              <div className="text-[11px] text-gray-500 truncate relative z-10 font-mono">{t.input}</div>
              {t.isRunning && <div className="relative z-10 pt-2"><MetricsTile id={t.id} stats={t.lastStats} lastMessage={lastMessage} /></div>}
            </motion.div>
          ))}
        </div>
      </section>
    </div>
  );
}

// End of TranscodePanel
