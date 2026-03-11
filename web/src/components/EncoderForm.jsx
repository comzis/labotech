import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Settings2, Server, ShieldCheck, Play, Radio, Activity, Plus, Trash2, Tv2 } from 'lucide-react';
import { startStream } from '../api';
import BentoCard, { containerVariants } from './ui/BentoCard';
import { Field, SelectField, PidField } from './ui/MatrixField';

const DEFAULTS = {
  id: '', input: '', inputLocalAddr: '',
  // Output transport
  outputMode: 'srt',
  host: '', port: '9999', latency: '2000', passphrase: '', pbkeylen: '16', adapter: '', streamId: '',
  ttl: '16', localAddr: '',
  // DVB/MPEG-TS service
  serviceId: '1', transportStreamId: '1', originalNetworkId: '1',
  pmtPid: '4096', videoPid: '256',
  serviceName: '', serviceProvider: '',
  // Video
  videoCodec: 'libx264', videoBitrate: '10', preset: 'medium', profile: 'high', gopSize: '50', rateMode: 'cbr',
};

const DEFAULT_PAIR = { sourceIndex: 0, codec: 'aac', bitrate: '256k', channels: 2, language: '', pid: '' };

// Animations moved to BentoCard.jsx

export default function EncoderForm({ onStarted }) {
  const [form, setForm] = useState(DEFAULTS);
  const [audioPairs, setAudioPairs] = useState([{ ...DEFAULT_PAIR }]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(false);

  const set = (k, v) => {
    if (k === 'outputMode') {
      setForm(f => ({
        ...f,
        outputMode: v,
        host: '',
        port: v === 'udp' || v === 'rtp' ? '6501' : '9999',
      }));
    } else {
      setForm(f => ({ ...f, [k]: v }));
    }
  };

  const addPair = () => setAudioPairs(p => [...p, { ...DEFAULT_PAIR, sourceIndex: p.length }]);
  const removePair = (i) => setAudioPairs(p => p.filter((_, idx) => idx !== i));
  const updatePair = (i, key, val) => setAudioPairs(p => p.map((pair, idx) => idx === i ? { ...pair, [key]: val } : pair));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const hostRequired = form.outputMode !== 'null';
      const cleanHost = (form.host || '').trim();
      if (hostRequired && !cleanHost) {
        throw new Error(`Target host is required for ${form.outputMode.toUpperCase()} output`);
      }
      await startStream({
        ...form,
        host: cleanHost,
        port: parseInt(form.port),
        latency: parseInt(form.latency),
        gopSize: parseInt(form.gopSize),
        ttl: parseInt(form.ttl),
        serviceId: parseInt(form.serviceId),
        transportStreamId: parseInt(form.transportStreamId),
        originalNetworkId: parseInt(form.originalNetworkId),
        pmtPid: parseInt(form.pmtPid),
        videoPid: parseInt(form.videoPid),
        audioPairs: audioPairs.map(p => ({
          ...p,
          sourceIndex: parseInt(p.sourceIndex),
          channels: parseInt(p.channels),
          pid: p.pid !== '' ? parseInt(p.pid) : undefined,
        })),
      });
      setForm(DEFAULTS);
      setAudioPairs([{ ...DEFAULT_PAIR }]);
      setOpen(false);
      onStarted && onStarted();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mb-12 font-sans">
      {!open && (
        <motion.button
          whileHover={{ scale: 1.02, boxShadow: '0 0 20px rgba(34,211,238,0.2)' }}
          whileTap={{ scale: 0.98 }}
          onClick={() => setOpen(true)}
          className="bg-gradient-to-r from-neon-blue/20 to-neon-cyan/20 border border-neon-cyan/35 backdrop-blur-md rounded-2xl px-6 py-3.5 flex items-center justify-center gap-3 w-full hover:from-neon-blue/30 hover:to-neon-cyan/30 transition-colors group cursor-pointer"
        >
          <div className="w-9 h-9 rounded-full bg-black/35 border border-neon-cyan/30 flex items-center justify-center group-hover:border-neon-cyan/50 transition-colors">
            <Radio className="w-4.5 h-4.5 text-neon-cyan" strokeWidth={1.8} />
          </div>
          <span className="text-gray-100 font-semibold tracking-wide text-base uppercase">Create Encoder Instance</span>
        </motion.button>
      )}

      {open && (
        <motion.form
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          onSubmit={handleSubmit}
          className="relative"
        >
          {/* Form Header */}
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
              <Settings2 className="w-6 h-6 text-neon-purple" strokeWidth={1.5} />
              Encoder Configuration
            </h2>
            <button type="button" onClick={() => setOpen(false)} className="text-gray-500 hover:text-white transition-colors text-sm font-medium">
              ✕ Cancel
            </button>
          </div>

          <motion.div variants={containerVariants} initial="hidden" animate="show" className="grid grid-cols-1 md:grid-cols-3 gap-6">

            {/* Bento Card 1: Transport & Networking (2 cols) */}
            <BentoCard icon={Server} title="Transport & Networking" className="md:col-span-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Channel ID *" value={form.id} onChange={v => set('id', v)} required />
                <Field label="Input Source *" value={form.input} onChange={v => set('input', v)} required placeholder="rtp://239.0.0.1:5000 or srt://source:9999" />
                <Field label="Input Bind IP (optional)" value={form.inputLocalAddr} onChange={v => set('inputLocalAddr', v)} placeholder="Leave blank for eno2 multicast" />

                {/* Output mode selector — spans full width */}
                <div className="sm:col-span-2">
                  <SelectField label="Output Mode" value={form.outputMode} onChange={v => set('outputMode', v)} options={[
                    { value: 'srt', label: 'SRT — Secure Reliable Transport' },
                    { value: 'rtp', label: 'RTP — MPEG-TS over RTP' },
                    { value: 'udp', label: 'UDP — Legacy Multicast / Unicast MPEG-TS' },
                  ]} />
                </div>

                {/* Target host + port — common to all modes */}
                <Field
                  label={form.outputMode === 'srt' ? 'SRT Target Host' : 'Destination IP'}
                  value={form.host} onChange={v => set('host', v)}
                  placeholder={form.outputMode === 'udp' || form.outputMode === 'rtp' ? '239.100.25.29' : 'srt://host or IP'}
                  required
                />
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Port" value={form.port} onChange={v => set('port', v)} type="number" />
                  {form.outputMode === 'srt'
                    ? <Field label="Latency (ms)" value={form.latency} onChange={v => set('latency', v)} type="number" />
                    : <Field label="TTL" value={form.ttl} onChange={v => set('ttl', v)} type="number" />
                  }
                </div>

                {/* SRT-only fields */}
                {form.outputMode === 'srt' && <>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Passphrase" value={form.passphrase} onChange={v => set('passphrase', v)} type="password" />
                    <SelectField label="Encryption" value={form.pbkeylen} onChange={v => set('pbkeylen', v)} options={[
                      { value: '16', label: 'AES-128' },
                      { value: '24', label: 'AES-192' },
                      { value: '32', label: 'AES-256' },
                      { value: '0', label: 'None' }
                    ]} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Adapter / Bind IP" value={form.adapter} onChange={v => set('adapter', v)} placeholder="10.67.18.29" />
                    <Field label="Stream ID" value={form.streamId} onChange={v => set('streamId', v)} placeholder="optional" />
                  </div>
                </>}

                {/* UDP / RTP — source NIC binding */}
                {(form.outputMode === 'udp' || form.outputMode === 'rtp') &&
                  <Field label="Output NIC / IP" value={form.localAddr} onChange={v => set('localAddr', v)} placeholder="eno2" />
                }
              </div>
            </BentoCard>

            {/* Bento Card 2: Audio Matrix — per-track codec / bitrate / PID / language */}
            <BentoCard icon={Radio} title="Audio Matrix" className="md:col-span-1 md:row-span-2 border-neon-cyan/20 bg-neon-cyan/5">
              <div className="space-y-3">
                {/* Column headers */}
                <div className="grid grid-cols-[36px_1fr_64px_40px_44px_44px_20px] gap-1 items-center">
                  <span className="text-[9px] font-semibold text-gray-500 uppercase tracking-wider text-center">Src</span>
                  <span className="text-[9px] font-semibold text-gray-500 uppercase tracking-wider">Codec</span>
                  <span className="text-[9px] font-semibold text-gray-500 uppercase tracking-wider">Bitrate</span>
                  <span className="text-[9px] font-semibold text-gray-500 uppercase tracking-wider text-center">Ch</span>
                  <span className="text-[9px] font-semibold text-gray-500 uppercase tracking-wider text-center">PID</span>
                  <span className="text-[9px] font-semibold text-gray-500 uppercase tracking-wider text-center">Lang</span>
                  <span />
                </div>

                {/* One row per audio pair */}
                {audioPairs.map((p, i) => (
                  <div key={i} className="grid grid-cols-[36px_1fr_64px_40px_44px_44px_20px] gap-1 items-center">
                    <input type="number" min="0" max="31" value={p.sourceIndex}
                      onChange={e => updatePair(i, 'sourceIndex', e.target.value)}
                      className="w-full bg-black/40 border border-white/10 rounded-lg px-1 py-2 text-xs text-gray-200 text-center focus:outline-none focus:border-neon-cyan/50 focus:bg-neon-cyan/5 transition-all" />
                    <select value={p.codec} onChange={e => updatePair(i, 'codec', e.target.value)}
                      className="w-full bg-black/40 border border-white/10 rounded-lg px-2 py-2 text-xs text-gray-200 focus:outline-none focus:border-neon-cyan/50 focus:bg-neon-cyan/5 transition-all appearance-none cursor-pointer">
                      {['aac', 'mp2', 'ac3', 'eac3', 'copy'].map(c => <option key={c} value={c} className="bg-midnight-surface">{c}</option>)}
                    </select>
                    <input type="text" value={p.bitrate} placeholder="256k"
                      onChange={e => updatePair(i, 'bitrate', e.target.value)}
                      className="w-full bg-black/40 border border-white/10 rounded-lg px-2 py-2 text-xs text-gray-200 focus:outline-none focus:border-neon-cyan/50 focus:bg-neon-cyan/5 transition-all" />
                    <select value={p.channels} onChange={e => updatePair(i, 'channels', e.target.value)}
                      className="w-full bg-black/40 border border-white/10 rounded-lg px-1 py-2 text-xs text-gray-200 focus:outline-none focus:border-neon-cyan/50 focus:bg-neon-cyan/5 transition-all appearance-none cursor-pointer">
                      <option value="1" className="bg-midnight-surface">1</option>
                      <option value="2" className="bg-midnight-surface">2</option>
                      <option value="6" className="bg-midnight-surface">6</option>
                    </select>
                    {/* PID — blank = auto (videoPid+1+index) */}
                    <input type="number" min="32" max="8190" value={p.pid} placeholder="auto"
                      onChange={e => updatePair(i, 'pid', e.target.value)}
                      className="w-full bg-black/40 border border-white/10 rounded-lg px-1 py-2 text-xs text-gray-200 text-center focus:outline-none focus:border-neon-purple/50 focus:bg-neon-purple/5 transition-all" />
                    <input type="text" value={p.language} placeholder="eng" maxLength={3}
                      onChange={e => updatePair(i, 'language', e.target.value.toLowerCase())}
                      className="w-full bg-black/40 border border-white/10 rounded-lg px-1 py-2 text-xs text-gray-200 text-center focus:outline-none focus:border-neon-cyan/50 focus:bg-neon-cyan/5 transition-all" />
                    <button type="button" onClick={() => removePair(i)} disabled={audioPairs.length === 1}
                      className="flex items-center justify-center text-gray-600 hover:text-red-400 transition-colors disabled:opacity-20 disabled:cursor-not-allowed">
                      <Trash2 className="w-3 h-3" strokeWidth={1.5} />
                    </button>
                  </div>
                ))}

                <button type="button" onClick={addPair} disabled={audioPairs.length >= 8}
                  className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-dashed border-white/15 text-[11px] text-gray-500 hover:text-neon-cyan hover:border-neon-cyan/40 transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
                  <Plus className="w-3 h-3" strokeWidth={2} />
                  Add Audio Pair
                </button>
              </div>
            </BentoCard>

            {/* Bento Card 3: DVB/TS Service */}
            <BentoCard icon={Tv2} title="DVB / TS Service" className="md:col-span-2 border-neon-purple/20 bg-neon-purple/5">
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <PidField label="Service ID" value={form.serviceId} onChange={v => set('serviceId', v)} />
                  <PidField label="TS ID" value={form.transportStreamId} onChange={v => set('transportStreamId', v)} />
                  <PidField label="Orig. Network ID" value={form.originalNetworkId} onChange={v => set('originalNetworkId', v)} />
                  <PidField label="PMT PID" value={form.pmtPid} onChange={v => set('pmtPid', v)} />
                  <PidField label="Video PID" value={form.videoPid} onChange={v => set('videoPid', v)} />
                  {/* PCR is carried on the video PID automatically */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider pl-1">PCR PID</label>
                    <div className="w-full bg-black/20 border border-white/5 rounded-lg px-3 py-2 text-xs text-gray-500 italic">
                      = Video PID
                    </div>
                  </div>
                </div>
                <Field label="Service Name" value={form.serviceName} onChange={v => set('serviceName', v)} placeholder="My Channel" />
                <Field label="Service Provider" value={form.serviceProvider} onChange={v => set('serviceProvider', v)} placeholder="Broadcaster" />
              </div>
            </BentoCard>

            {/* Bento Card 4: Video Matrix (full width) */}
            <BentoCard icon={Activity} title="Video Matrix" className="md:col-span-3 border-neon-purple/20 bg-neon-purple/5">
              <div className="mb-3 text-[11px] text-amber-300/90 font-semibold tracking-wide">
                GPU please 🙂 - CPU is working overtime.
              </div>
              <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
                <SelectField label="Codec" value={form.videoCodec} onChange={v => set('videoCodec', v)} options={['libx264', 'libx265', 'copy']} />
                <SelectField label="Profile" value={form.profile} onChange={v => set('profile', v)} options={['baseline', 'main', 'high', 'high422']} />
                <SelectField label="Preset" value={form.preset} onChange={v => set('preset', v)} options={['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow']} />
                <Field label="Bitrate (Mbps)" value={form.videoBitrate} onChange={v => set('videoBitrate', v)} placeholder="e.g. 10 or 12.5" />
                <Field label="GOP" value={form.gopSize} onChange={v => set('gopSize', v)} type="number" />
                <SelectField label="Rate Mode" value={form.rateMode} onChange={v => set('rateMode', v)} options={[{ value: 'cbr', label: 'CBR' }, { value: 'vbr', label: 'VBR' }]} />
              </div>
              <div className="mt-2 text-[10px] text-gray-500">
                Enter Mbps as a number. No fixed app cap; practical range depends on codec, profile, and transport capacity.
              </div>
            </BentoCard>

          </motion.div>

          {error && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-6 bg-red-950/50 border border-red-500/50 text-red-200 p-4 rounded-xl flex items-center gap-3 backdrop-blur-md">
              <ShieldCheck className="w-5 h-5 text-red-400" />
              <p className="text-sm font-medium">{error}</p>
            </motion.div>
          )}

          {/* Action Footer */}
          <div className="mt-8 flex justify-end">
            <motion.button
              whileHover={{ scale: 1.05, boxShadow: '0 0 25px rgba(34,211,238,0.4)' }}
              whileTap={{ scale: 0.95 }}
              type="submit"
              disabled={loading}
              className="relative group overflow-hidden bg-gradient-to-r from-neon-blue to-neon-cyan text-midnight-base font-bold px-8 py-3 rounded-xl flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="animate-pulse">Initializing Matrix...</span>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-current" />
                  START ENCODER
                </>
              )}
            </motion.button>
          </div>
        </motion.form>
      )}
    </div>
  );
}

// End of EncoderForm
