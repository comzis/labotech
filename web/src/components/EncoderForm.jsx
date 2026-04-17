import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Settings2, Server, ShieldCheck, Play, Radio, Activity, Plus, Trash2, Tv2 } from 'lucide-react';
import { startStream } from '../api';
import BentoCard, { containerVariants } from './ui/BentoCard';
import { Field, SelectField, PidField } from './ui/MatrixField';
import { C } from './BroadcastUI';

const DEFAULTS = {
  id: '', inputMode: 'rtp', inputHost: '', inputPort: '6501', input: '', inputLocalAddr: '',
  // Output transport (encapsulator only)
  outputMode: 'srt',
  host: '', port: '9999', latency: '2000', passphrase: '', pbkeylen: '16', adapter: '', streamId: '',
  ttl: '16', localAddr: '',
  // DVB/MPEG-TS service
  serviceId: '1', transportStreamId: '1', originalNetworkId: '1',
  pmtPid: '4096', videoPid: '256',
  serviceName: '', serviceProvider: '',
  // Video (encapsulation passthrough)
  videoCodec: 'copy', videoBitrate: '', preset: 'medium', profile: '', gopSize: '50', rateMode: 'cbr',
};

const DEFAULT_PAIR = { sourceIndex: 0, codec: 'copy', bitrate: '', channels: 2, language: '', pid: '' };
const formatPidHex = (pid) => (pid == null || Number.isNaN(Number(pid)) ? null : `0x${Number(pid).toString(16).toUpperCase().padStart(4, '0')}`);

function buildInputUrl(inputMode, inputHost, inputPort, rawInput) {
  if (inputMode === 'custom') return (rawInput || '').trim();
  const host = (inputHost || '').trim();
  const port = String(inputPort || '').trim();
  if (!host || !port) return '';
  if (inputMode === 'rtp') return `rtp://${host}:${port}`;
  if (inputMode === 'udp') return `udp://${host}:${port}`;
  if (inputMode === 'srt') return `srt://${host}:${port}`;
  return '';
}

// Animations moved to BentoCard.jsx

export default function EncoderForm({ onStarted }) {
  const [form, setForm] = useState(DEFAULTS);
  const [audioPairs, setAudioPairs] = useState([{ ...DEFAULT_PAIR }]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(false);

  const set = (k, v) => {
    setForm(f => ({ ...f, [k]: v }));
  };

  const addPair = () => setAudioPairs(p => [...p, { ...DEFAULT_PAIR, sourceIndex: p.length }]);
  const removePair = (i) => setAudioPairs(p => p.filter((_, idx) => idx !== i));
  const updatePair = (i, key, val) => setAudioPairs(p => p.map((pair, idx) => idx === i ? { ...pair, [key]: val } : pair));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const builtInput = buildInputUrl(form.inputMode, form.inputHost, form.inputPort, form.input);
      if (!builtInput) {
        throw new Error('Input source is required (host + port, or custom URL)');
      }
      const hostRequired = form.outputMode !== 'null';
      const cleanHost = (form.host || '').trim();
      if (hostRequired && !cleanHost) {
        throw new Error(`Target host is required for ${form.outputMode.toUpperCase()} output`);
      }
      await startStream({
        ...form,
        input: builtInput,
        outputMode: 'srt',
        host: cleanHost,
        port: parseInt(form.port),
        latency: parseInt(form.latency),
        videoCodec: 'copy',
        rateMode: 'cbr',
        gopSize: parseInt(form.gopSize),
        ttl: parseInt(form.ttl),
        serviceId: parseInt(form.serviceId),
        transportStreamId: parseInt(form.transportStreamId),
        originalNetworkId: parseInt(form.originalNetworkId),
        pmtPid: parseInt(form.pmtPid),
        videoPid: parseInt(form.videoPid),
        audioPairs: audioPairs.map(p => ({
          ...p,
          codec: 'copy',
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
    <div className="broadcast-legacy" style={{ marginBottom: 48, fontFamily: "'Courier New',monospace", color: C.text }}>
      {!open && (
        <div
          className="flex justify-between items-center gap-3"
          style={{
            borderBottom: `1px solid ${C.border}`,
            paddingBottom: 6,
            marginBottom: 8,
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Activity className="w-4 h-4 text-emerald-400" strokeWidth={1.8} />
              <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.05em', color: C.text }}>SRT Encapsulator</div>
            </div>
            <div style={{ fontSize: 9, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: 2 }}>
              Haivision Caller Mode / TS Pass-through
            </div>
          </div>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-sm text-[10px] font-bold uppercase tracking-[0.1em] transition-all rack-button-glow"
            style={{
              border: `1px solid ${C.ok}`,
              background: `${C.ok}14`,
              color: C.ok,
              boxShadow: `inset 0 1px 0 rgba(255,255,255,0.04), 0 0 8px ${C.ok}22`,
            }}
          >
            <Tv2 className="w-3 h-3" />
            Create SRT Channel
          </motion.button>
        </div>
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
              SRT Encapsulator Configuration
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
                <SelectField label="Input Mode" value={form.inputMode} onChange={v => set('inputMode', v)} options={[
                  { value: 'rtp', label: 'RTP' },
                  { value: 'udp', label: 'UDP' },
                  { value: 'srt', label: 'SRT' },
                  { value: 'custom', label: 'Custom URL' },
                ]} />
                {form.inputMode !== 'custom' ? (
                  <>
                    <Field label="Input Host / IP *" value={form.inputHost} onChange={v => set('inputHost', v)} required placeholder="Example: 239.100.25.29" />
                    <Field label="Input Port *" value={form.inputPort} onChange={v => set('inputPort', v)} type="number" required placeholder="Example: 6501" />
                  </>
                ) : (
                  <div className="sm:col-span-2">
                    <Field label="Input Source URL *" value={form.input} onChange={v => set('input', v)} required placeholder="Example: rtp://239.100.25.29:6501" />
                  </div>
                )}
                <Field label="Input Bind IP (optional)" value={form.inputLocalAddr} onChange={v => set('inputLocalAddr', v)} placeholder="Example: 192.168.1.10" />

                {/* Target host + port — common to all modes */}
                <Field
                  label="SRT Target Host"
                  value={form.host} onChange={v => set('host', v)}
                  placeholder="Example: 203.0.113.24"
                  required
                />
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Port" value={form.port} onChange={v => set('port', v)} type="number" />
                  <Field label="Latency (ms)" value={form.latency} onChange={v => set('latency', v)} type="number" />
                </div>

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
                  <Field label="Adapter / Bind IP" value={form.adapter} onChange={v => set('adapter', v)} placeholder="Example: eno2 or 192.168.1.10" />
                  <Field label="Stream ID" value={form.streamId} onChange={v => set('streamId', v)} placeholder="Example: channel-alpha" />
                </div>
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
                    <div className="w-full bg-black/20 border border-white/10 rounded-lg px-2 py-2 text-xs text-gray-400">
                      copy
                    </div>
                    <div className="w-full bg-black/20 border border-white/10 rounded-lg px-2 py-2 text-xs text-gray-500">
                      n/a
                    </div>
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

            {/* Bento Card 4: Encapsulation profile (full width) */}
            <BentoCard icon={Activity} title="Encapsulation Profile" className="md:col-span-3 border-neon-purple/20 bg-neon-purple/5">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wider text-gray-500">Video</div>
                  <div className="text-sm text-gray-200 font-semibold">copy</div>
                </div>
                <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wider text-gray-500">Audio</div>
                  <div className="text-sm text-gray-200 font-semibold">copy (per track)</div>
                </div>
                <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wider text-gray-500">Mux</div>
                  <div className="text-sm text-gray-200 font-semibold">MPEG-TS</div>
                </div>
                <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wider text-gray-500">Output</div>
                  <div className="text-sm text-gray-200 font-semibold">Haivision SRT caller</div>
                </div>
              </div>
              <div className="mt-2 text-[10px] text-gray-500">
                Dedicated encapsulation mode keeps source codecs untouched and focuses on SRT delivery reliability.
              </div>
            </BentoCard>

            <BentoCard icon={Tv2} title="PID Map" className="md:col-span-1 border-neon-purple/20 bg-neon-purple/5">
              <div className="space-y-2 text-xs">
                <div className="flex justify-between"><span className="text-gray-500">PMT PID</span><span className="font-mono text-gray-300">{form.pmtPid} <span className="text-gray-500">{formatPidHex(form.pmtPid) || ''}</span></span></div>
                <div className="flex justify-between"><span className="text-gray-500">Video PID</span><span className="font-mono text-gray-300">{form.videoPid} <span className="text-gray-500">{formatPidHex(form.videoPid) || ''}</span></span></div>
                {audioPairs.map((p, i) => (
                  <div key={`pidrow-${i}`} className="flex justify-between">
                    <span className="text-gray-500">Audio {i + 1}</span>
                    <span className="font-mono text-gray-300">
                      {p.pid !== '' ? (
                        <>
                          {p.pid} <span className="text-gray-500">{formatPidHex(p.pid) || ''}</span>
                        </>
                      ) : (
                        `auto(${Number(form.videoPid || 0) + i + 1})`
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </BentoCard>

            <BentoCard icon={Server} title="Mux Settings" className="md:col-span-1 border-neon-cyan/20 bg-neon-cyan/5">
              <div className="space-y-2 text-xs">
                <div className="flex justify-between"><span className="text-gray-500">Output mode</span><span className="font-mono text-gray-300 uppercase">srt</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Role</span><span className="font-mono text-gray-300">caller</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Adapter</span><span className="font-mono text-gray-300">{form.adapter || form.localAddr || '-'}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Service ID</span><span className="font-mono text-gray-300">{form.serviceId}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">TS / ONID</span><span className="font-mono text-gray-300">{form.transportStreamId} / {form.originalNetworkId}</span></div>
              </div>
            </BentoCard>

            <BentoCard icon={Settings2} title="Haivision Telemetry" className="md:col-span-1 border-neon-green/20 bg-neon-green/5">
              <div className="space-y-3">
                <div className="text-[10px] text-gray-500">
                  Runtime panel surfaces RTT, rate, bandwidth, loss, retransmissions, and NAK counters from SRT libsrt statistics.
                </div>
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
                  START ENCAPSULATION
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
