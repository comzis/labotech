import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Activity, Settings2, Tv2, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import BentoCard, { containerVariants } from './ui/BentoCard';
import { Field } from './ui/MatrixField';
import { getPresets, getBroadcastPresets, getTranscoders, startTranscoder, stopTranscoder, probeUrl } from '../api';
import StatusDot from './StatusDot';
import MetricsTile from './MetricsTile';
import { C } from './BroadcastUI';

const DEFAULTS = {
  id: '',
  input: '',
  host: '',
  port: '9999',
  transcodePreset: 'pal',
  broadcastPresetSlot: '',
  standardProfile: 'dvb-hd',
  videoBitrate: '',
  audioBitrate: '',
  videoCodec: '',
  audioCodec: '',
  audioPairsEnabled: false,
  audioPairTemplate: 'custom',
  audioPairs: [
    { sourceIndex: '0', codec: 'aac', bitrate: '192k', channels: '2', language: 'eng' },
    { sourceIndex: '1', codec: 'aac', bitrate: '192k', channels: '2', language: 'nat' },
  ],
  serviceName: '',
  serviceProvider: '',
  passphrase: '',
  outputMode: 'srt',
  localAddr: '',
};

const OUTPUT_MODES = [
  { value: 'srt',  label: 'SRT',  desc: 'Haivision SRT' },
  { value: 'rtp',  label: 'RTP',  desc: 'RTP/MPEG-TS' },
  { value: 'udp',  label: 'UDP',  desc: 'Legacy Multicast' },
];

const STANDARD_PROFILES = [
  { value: 'dvb-hd', label: 'DVB HD (Distribution)', videoCodec: 'libx264', audioCodec: 'aac', videoBitrate: '10M', audioBitrate: '192k' },
  { value: 'dvb-contribution', label: 'DVB Contribution 4:2:2', videoCodec: 'libx264', audioCodec: 'aac', videoBitrate: '30M', audioBitrate: '384k' },
  { value: 'dvb-hevc', label: 'DVB HEVC UHD', videoCodec: 'libx265', audioCodec: 'aac', videoBitrate: '20M', audioBitrate: '384k' },
  { value: 'ebu-loudness-safe', label: 'R128 Ready', videoCodec: 'libx264', audioCodec: 'aac', videoBitrate: '10M', audioBitrate: '256k' },
  { value: 'passthrough', label: 'Pass-through / Remux', videoCodec: 'copy', audioCodec: 'copy', videoBitrate: '', audioBitrate: '' },
];

const AUDIO_PAIR_TEMPLATES = [
  { value: 'custom', label: 'Custom (manual)' },
  { value: 'eng-nat', label: 'ENG / NAT (2 pairs)' },
  { value: 'me-ad', label: 'M&E / AD (2 pairs)' },
];

function buildTemplatePairs(template) {
  if (template === 'eng-nat') {
    return [
      { sourceIndex: '0', codec: 'aac', bitrate: '192k', channels: '2', language: 'eng' },
      { sourceIndex: '1', codec: 'aac', bitrate: '192k', channels: '2', language: 'nat' },
    ];
  }
  if (template === 'me-ad') {
    return [
      { sourceIndex: '0', codec: 'aac', bitrate: '192k', channels: '2', language: 'mis' },
      { sourceIndex: '1', codec: 'aac', bitrate: '128k', channels: '2', language: 'qad' },
    ];
  }
  return null;
}

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
  const [importingPairs, setImportingPairs] = useState(false);

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
  const updateAudioPair = (idx, key, value) => {
    setForm((prev) => ({
      ...prev,
      audioPairs: prev.audioPairs.map((pair, i) => (i === idx ? { ...pair, [key]: value } : pair)),
    }));
  };
  const addAudioPair = () => {
    setForm((prev) => {
      if (prev.audioPairs.length >= 8) return prev;
      return {
        ...prev,
        audioPairs: [
          ...prev.audioPairs,
          { sourceIndex: String(prev.audioPairs.length), codec: 'aac', bitrate: '192k', channels: '2', language: '' },
        ],
      };
    });
  };
  const removeAudioPair = (idx) => {
    setForm((prev) => {
      if (prev.audioPairs.length <= 1) return prev;
      return { ...prev, audioPairs: prev.audioPairs.filter((_, i) => i !== idx) };
    });
  };
  const applyAudioPairTemplate = (templateValue) => {
    setForm((prev) => {
      const pairs = buildTemplatePairs(templateValue);
      return {
        ...prev,
        audioPairTemplate: templateValue,
        audioPairs: pairs || prev.audioPairs,
      };
    });
  };

  const handleImportAudioPairs = async () => {
    if (!form.input) {
      setError('Input Source is required to import audio pairs from TS.');
      return;
    }
    setImportingPairs(true);
    setError(null);
    try {
      const result = await probeUrl(form.input);
      const audioStreams = (result?.programs || [])
        .flatMap((program) => program.streams || [])
        .filter((stream) => stream.codecType === 'audio');

      if (audioStreams.length === 0) {
        setError('No audio tracks detected in TS probe result.');
        return;
      }

      const pairs = audioStreams.slice(0, 8).map((stream, idx) => {
        const bitrateK = stream.bitrate ? `${Math.max(64, Math.round(stream.bitrate / 1000))}k` : '192k';
        return {
          sourceIndex: String(stream.index ?? idx),
          codec: 'aac',
          bitrate: bitrateK,
          channels: String(stream.channels || 2),
          language: stream.language || '',
        };
      });

      setForm((prev) => ({
        ...prev,
        audioPairsEnabled: true,
        audioPairTemplate: 'custom',
        audioPairs: pairs,
      }));
      toast.success(`Imported ${pairs.length} audio pair${pairs.length > 1 ? 's' : ''} from TS probe`);
    } catch (err) {
      setError(`Audio pair import failed: ${err.message}`);
    } finally {
      setImportingPairs(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const payload = { ...form, port: parseInt(form.port, 10) };
      if (payload.broadcastPresetSlot) payload.broadcastPresetSlot = parseInt(payload.broadcastPresetSlot);
      if (payload.standardProfile) {
        const profile = STANDARD_PROFILES.find(p => p.value === payload.standardProfile);
        if (profile) {
          payload.videoCodec = payload.videoCodec || profile.videoCodec;
          payload.audioCodec = payload.audioCodec || profile.audioCodec;
          if (!payload.videoBitrate && profile.videoBitrate) payload.videoBitrate = profile.videoBitrate;
          if (!payload.audioBitrate && profile.audioBitrate) payload.audioBitrate = profile.audioBitrate;
        }
      }
      if (payload.videoCodec === 'copy') {
        payload.audioCodec = payload.audioCodec || 'copy';
        payload.videoBitrate = null;
        payload.audioBitrate = null;
      }
      if (payload.audioPairsEnabled) {
        payload.audioPairs = (payload.audioPairs || [])
          .slice(0, 8)
          .map((pair, idx) => ({
            sourceIndex: parseInt(pair.sourceIndex, 10) || idx,
            codec: pair.codec || 'aac',
            bitrate: pair.bitrate || '192k',
            channels: parseInt(pair.channels, 10) || 2,
            language: pair.language || undefined,
          }));
      } else {
        delete payload.audioPairs;
      }
      delete payload.audioPairsEnabled;
      delete payload.audioPairTemplate;
      if (!payload.videoCodec) delete payload.videoCodec;
      if (!payload.audioCodec) delete payload.audioCodec;

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
    <div style={{ fontFamily: "'Courier New',monospace", color: C.text, display: 'grid', gap: 24 }}>
      {/* Start form Toggle */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
            <Activity className="w-6 h-6 text-neon-purple" strokeWidth={1.5} />
            Transcoder
          </h1>
          <p className="text-xs text-gray-500 mt-1 uppercase tracking-widest font-medium opacity-80">Service Conditioning and Delivery</p>
        </div>
        <button
          onClick={() => setOpen(o => !o)}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold uppercase tracking-wide transition-all ${open
            ? 'bg-gray-800 text-gray-400 hover:text-white border border-white/10'
            : 'bg-gradient-to-r from-neon-purple/25 to-purple-600/25 border border-neon-purple/35 text-purple-100 shadow-lg shadow-neon-purple/15 hover:shadow-neon-purple/30'
            }`}
        >
          {open ? 'Cancel' : <><Tv2 className="w-4 h-4" /> Create Broadcast Profile</>}
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
            <BentoCard icon={Tv2} title="2. Profile Matrix" className="border-neon-purple/20 bg-neon-purple/5">
              <div className="space-y-4">
                <div>
                  <label className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider pl-1 mb-1.5 block">Broadcast Standard Profile</label>
                  <select
                    value={form.standardProfile}
                    onChange={e => set('standardProfile', e.target.value)}
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-gray-200 focus:outline-none focus:border-neon-purple/50 transition-all appearance-none cursor-pointer"
                    style={{ backgroundImage: `url('data:image/svg+xml;utf8,<svg fill="%239ca3af" height="20" viewBox="0 0 24 24" width="20" xmlns="http://www.w3.org/2000/svg"><path d="M7 10l5 5 5-5z"/><path d="M0 0h24v24H0z" fill="none"/></svg>')`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center' }}
                  >
                    {STANDARD_PROFILES.map(sp => (
                      <option key={sp.value} value={sp.value} className="bg-midnight-surface">{sp.label}</option>
                    ))}
                  </select>
                </div>
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
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider pl-1">Video Codec</label>
                    <select
                      value={form.videoCodec}
                      onChange={(e) => set('videoCodec', e.target.value)}
                      className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-gray-200"
                    >
                      <option value="" className="bg-midnight-surface">Auto (from profile/slot)</option>
                      <option value="libx264" className="bg-midnight-surface">H.264 (libx264)</option>
                      <option value="libx265" className="bg-midnight-surface">H.265/HEVC (libx265)</option>
                      <option value="copy" className="bg-midnight-surface">Pass-through (copy)</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider pl-1">Audio Codec</label>
                    <select
                      value={form.audioCodec}
                      onChange={(e) => set('audioCodec', e.target.value)}
                      className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-gray-200"
                    >
                      <option value="" className="bg-midnight-surface">Auto (from profile/slot)</option>
                      <option value="aac" className="bg-midnight-surface">AAC-LC</option>
                      <option value="mp2" className="bg-midnight-surface">MPEG-1 Layer II (MP2)</option>
                      <option value="ac3" className="bg-midnight-surface">AC-3 (Dolby Digital)</option>
                      <option value="eac3" className="bg-midnight-surface">E-AC-3 (Dolby Digital Plus)</option>
                      <option value="copy" className="bg-midnight-surface">Pass-through (copy)</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Video Bitrate (Mbps)" placeholder="e.g. 10" value={form.videoBitrate} onChange={v => set('videoBitrate', v)} color="purple" />
                  <Field label="Audio Bitrate" placeholder="e.g. 256k" value={form.audioBitrate} onChange={v => set('audioBitrate', v)} color="purple" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Service Name (DVB)" placeholder="LABOTECH HD" value={form.serviceName} onChange={v => set('serviceName', v)} color="purple" />
                  <Field label="Service Provider (DVB)" placeholder="LABOTECH" value={form.serviceProvider} onChange={v => set('serviceProvider', v)} color="purple" />
                </div>
                <label className="flex items-center gap-2 text-xs text-gray-300">
                  <input
                    type="checkbox"
                    checked={form.audioPairsEnabled}
                    onChange={(e) => set('audioPairsEnabled', e.target.checked)}
                    className="accent-purple-400"
                  />
                  Enable audio pairs (1 to 8 tracks)
                </label>
                {form.audioPairsEnabled && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="flex flex-col gap-1.5">
                        <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider pl-1">Audio Template (optional)</label>
                        <select
                          value={form.audioPairTemplate}
                          onChange={(e) => applyAudioPairTemplate(e.target.value)}
                          className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-gray-200"
                        >
                          {AUDIO_PAIR_TEMPLATES.map((tpl) => (
                            <option key={tpl.value} value={tpl.value} className="bg-midnight-surface">{tpl.label}</option>
                          ))}
                        </select>
                      </div>
                      <div className="flex items-end gap-2">
                        <button
                          type="button"
                          onClick={handleImportAudioPairs}
                          disabled={importingPairs || !form.input}
                          className="px-3 py-2 text-xs rounded-lg border border-neon-cyan/40 text-neon-cyan hover:bg-neon-cyan/10 disabled:opacity-50"
                        >
                          {importingPairs ? 'Importing...' : 'Import from TS'}
                        </button>
                        <button
                          type="button"
                          onClick={addAudioPair}
                          disabled={form.audioPairs.length >= 8}
                          className="px-3 py-2 text-xs rounded-lg border border-neon-purple/40 text-neon-purple hover:bg-neon-purple/10 disabled:opacity-50"
                        >
                          + Add Pair
                        </button>
                        <div className="text-[10px] text-gray-500">Pairs: {form.audioPairs.length}/8</div>
                      </div>
                    </div>
                    <p className="text-[10px] text-gray-500">
                      Templates are operator presets. TS can expose language tags when present, but not every source provides reliable metadata.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {form.audioPairs.map((pair, idx) => (
                        <div key={`pair-${idx}`} className="p-3 rounded-xl border border-white/10 bg-black/20 space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="text-[10px] uppercase tracking-wider text-gray-400">Audio Pair {idx + 1}</div>
                            <button
                              type="button"
                              onClick={() => removeAudioPair(idx)}
                              disabled={form.audioPairs.length <= 1}
                              className="text-[10px] px-2 py-1 rounded border border-red-500/30 text-red-300 disabled:opacity-40"
                            >
                              Remove
                            </button>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <Field label="Source Index" value={pair.sourceIndex} onChange={v => updateAudioPair(idx, 'sourceIndex', v)} type="number" color="purple" />
                            <Field label="Channels" value={pair.channels} onChange={v => updateAudioPair(idx, 'channels', v)} type="number" color="purple" />
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <Field label="Codec" value={pair.codec} onChange={v => updateAudioPair(idx, 'codec', v)} placeholder="aac|copy|ac3(dolby digital)|eac3(dd+)|mp2" color="purple" />
                            <Field label="Bitrate" value={pair.bitrate} onChange={v => updateAudioPair(idx, 'bitrate', v)} placeholder="192k" color="purple" />
                          </div>
                          <Field label="Language" value={pair.language} onChange={v => updateAudioPair(idx, 'language', v)} placeholder="eng / nat / qad" color="purple" />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <p className="text-[10px] text-gray-500 italic opacity-70">Leave codec/bitrates empty to use selected standard profile or preset slot defaults.</p>
              </div>
            </BentoCard>

            {/* Step 3: Destination Matrix */}
            <BentoCard icon={Share2} title="3. Destination Matrix" className="border-neon-green/20 bg-neon-green/5">
              <div className="space-y-4">
                <div>
                  <label className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider pl-1 mb-1.5 block">Output Mode</label>
                  <div className="grid grid-cols-3 gap-2">
                    {OUTPUT_MODES.map(m => (
                      <button
                        key={m.value}
                        type="button"
                        onClick={() => set('outputMode', m.value)}
                        className={`px-3 py-2.5 rounded-xl border text-center transition-all ${form.outputMode === m.value
                          ? 'bg-neon-green/20 border-neon-green/50 text-white ring-1 ring-neon-green/50'
                          : 'bg-black/30 border-white/10 text-gray-500 hover:border-white/20 hover:bg-black/40'
                        }`}
                      >
                        <div className="text-xs font-bold">{m.label}</div>
                        <div className="text-[9px] opacity-60 mt-0.5 uppercase tracking-tighter">{m.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>
                <Field label="Stream ID *" placeholder="channel-1-transcoded" value={form.id} onChange={v => set('id', v)} required color="green" />
                <Field label="Input Source *" placeholder="rtp://239.0.0.1:5000 or srt://source:9999" value={form.input} onChange={v => set('input', v)} required color="green" />
                <div className="grid grid-cols-2 gap-4">
                  <Field
                    label={form.outputMode === 'srt' ? 'SRT Target Host *' : 'Destination IP *'}
                    placeholder={form.outputMode === 'srt' ? '10.67.18.29' : '239.100.25.29'}
                    value={form.host}
                    onChange={v => set('host', v)}
                    required
                    color="green"
                  />
                  <Field label="Port *" value={form.port} onChange={v => set('port', v)} type="number" required color="green" />
                </div>
                {(form.outputMode === 'udp' || form.outputMode === 'rtp') && (
                  <Field label="Output NIC / IP" placeholder="eno2" value={form.localAddr} onChange={v => set('localAddr', v)} color="green" />
                )}
                {form.outputMode === 'srt' && (
                  <Field label="Passphrase" placeholder="Optional SRT passphrase" value={form.passphrase} onChange={v => set('passphrase', v)} color="green" />
                )}
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
              {loading ? 'Initializing Broadcast Profile...' : 'Start Broadcast Transcoder'}
            </motion.button>
          </div>
        </motion.form>
      )}

      {/* Active transcoders Section */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm text-gray-400 uppercase tracking-widest font-bold opacity-80">
            Active Broadcast Pipelines ({transcoders.length})
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
              <div className="text-xs font-bold text-neon-purple/80 uppercase tracking-wide relative z-10">{t.presetName || 'Custom'}</div>
              <div className="text-[11px] text-gray-500 truncate relative z-10 font-mono">{t.input}</div>
              {t.encodeProfile && (
                <div className="text-[10px] text-gray-500 font-mono relative z-10">
                  {t.encodeProfile.videoCodec || '-'} / {(t.audioPairs?.[0]?.codec) || 'audio-auto'} / {t.encodeProfile.rateMode || 'cbr'}
                </div>
              )}
              {t.isRunning && <div className="relative z-10 pt-2"><MetricsTile id={t.id} stats={t.lastStats} lastMessage={lastMessage} /></div>}
            </motion.div>
          ))}
        </div>
      </section>
    </div>
  );
}

// End of TranscodePanel
