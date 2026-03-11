import React, { useState, useEffect } from 'react';
import { getMulticastConfig, getForwarders, startForwarder, stopForwarder } from '../api';
import StatusDot from './StatusDot';
import MetricsTile from './MetricsTile';
import { motion, AnimatePresence } from 'framer-motion';
import { Network, Settings2, Globe, Share2 } from 'lucide-react';
import BentoCard, { containerVariants } from './ui/BentoCard';
import { Field } from './ui/MatrixField';

const DEFAULTS = {
  id: '',
  sourceMode: 'rtp',
  sourceHost: '',
  sourcePort: '5000',
  destIp: '',
  destPort: '1234',
};

function buildSourceUrl({ sourceMode, sourceHost, sourcePort }) {
  if (!sourceHost || !sourcePort) return '';
  if (sourceMode === 'rtp') return `rtp://${sourceHost}:${sourcePort}`;
  if (sourceMode === 'srt') return `srt://${sourceHost}:${sourcePort}?mode=listener&latency=2000`;
  return `udp://${sourceHost}:${sourcePort}`;
}

export default function MulticastPanel({ lastMessage }) {
  const [config, setConfig] = useState(null);
  const [forwarders, setForwarders] = useState([]);
  const [form, setForm] = useState(DEFAULTS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(false);

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
      const sourceUrl = buildSourceUrl(form);
      if (!sourceUrl) throw new Error('Source host and source port are required');
      await startForwarder({
        id: form.id,
        sourceUrl,
        destIp: form.destIp,
        destPort: parseInt(form.destPort),
      });
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
    <div className="space-y-8 font-sans">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
            <Network className="w-6 h-6 text-neon-green" strokeWidth={1.5} />
            Forwarder Workflow
          </h1>
          <p className="text-xs text-gray-500 mt-1 uppercase tracking-widest font-medium opacity-80">Network Distribution & Group Forwarding</p>
        </div>
        <button
          onClick={() => setOpen(o => !o)}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold uppercase tracking-wide transition-all ${open
            ? 'bg-gray-800 text-gray-400 hover:text-white border border-white/10'
            : 'bg-gradient-to-r from-neon-green/25 to-green-600/25 border border-neon-green/35 text-green-100 shadow-lg shadow-neon-green/15 hover:shadow-neon-green/30'
            }`}
        >
          {open ? 'Cancel' : <><Share2 className="w-4 h-4" /> Deploy Forwarder</>}
        </button>
      </div>

      {/* Config Overview Bento Card */}
      {config && (
        <BentoCard icon={Settings2} title="Interface Configuration" accentColor="green">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {[
              ['NIC', config.nic],
              ['Subnet', config.subnet],
              ['Default IP', config.address],
              ['TTL', config.ttl],
            ].map(([k, v]) => (
              <div key={k}>
                <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-1.5 font-bold">{k}</div>
                <div className="font-mono text-neon-green/90 text-sm">{v}</div>
              </div>
            ))}
          </div>
        </BentoCard>
      )}

      {/* Deploy Form */}
      <AnimatePresence>
        {open && (
          <motion.form
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            onSubmit={handleSubmit}
            className="relative"
          >
            <motion.div variants={containerVariants} initial="hidden" animate="show" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              <BentoCard icon={Globe} title="Source Configuration" accentColor="green">
                <div className="space-y-4">
                  <Field label="Forwarder ID *" value={form.id} onChange={v => set('id', v)} required color="green" />
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider pl-1">Source Protocol</label>
                      <select
                        value={form.sourceMode}
                        onChange={e => set('sourceMode', e.target.value)}
                        className="mt-1 w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-gray-200"
                      >
                        <option value="rtp">RTP</option>
                        <option value="srt">SRT</option>
                        <option value="udp">UDP (Legacy)</option>
                      </select>
                    </div>
                    <div className="col-span-2">
                      <Field label="Source Host / IP *" value={form.sourceHost} onChange={v => set('sourceHost', v)} required color="green" placeholder="239.100.25.10" />
                    </div>
                  </div>
                  <Field label="Source Port *" value={form.sourcePort} onChange={v => set('sourcePort', v)} type="number" required color="green" placeholder="5000" />
                  <div className="text-[10px] text-gray-500 font-mono bg-black/20 border border-white/5 rounded px-2 py-1.5">
                    {buildSourceUrl(form) || 'Source URL preview'}
                  </div>
                </div>
              </BentoCard>

              <BentoCard icon={Share2} title="Destination Configuration" accentColor="green">
                <div className="space-y-4">
                  <Field label="Dest IP *" value={form.destIp} onChange={v => set('destIp', v)} required color="green" placeholder="239.100.25.x" />
                  <Field label="Dest Port" value={form.destPort} onChange={v => set('destPort', v)} type="number" color="green" />
                </div>
              </BentoCard>

              <div className="flex items-end justify-end">
                <motion.button
                  whileHover={{ scale: 1.05, boxShadow: '0 0 25px rgba(34,197,94,0.4)' }}
                  whileTap={{ scale: 0.95 }}
                  type="submit"
                  disabled={loading}
                  className="bg-gradient-to-r from-neon-green to-green-600 text-white font-bold px-10 py-3 rounded-xl shadow-lg transition-all disabled:opacity-50"
                >
                  {loading ? 'Initializing Forwarder...' : 'INITIATE FORWARDER'}
                </motion.button>
              </div>
            </motion.div>
            {error && (
              <p className="mt-4 text-red-400 text-sm bg-red-900/20 border border-red-500/30 p-3 rounded-xl">{error}</p>
            )}
          </motion.form>
        )}
      </AnimatePresence>

      {/* Active Forwarders */}
      <section>
        <h2 className="text-sm text-gray-400 mb-4 uppercase tracking-widest font-bold opacity-80">
          Running Forwarders ({forwarders.length})
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {forwarders.map(f => (
            <motion.div
              key={f.id}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-midnight-glass border border-white/5 backdrop-blur-xl rounded-2xl p-4 space-y-3 relative overflow-hidden group"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
              <div className="flex items-center justify-between relative z-10">
                <div className="flex items-center gap-2">
                  <StatusDot status={f.isRunning ? 'live' : 'stopped'} pulse />
                  <span className="font-mono text-sm font-semibold text-gray-200">{f.id}</span>
                </div>
                {f.isRunning && (
                  <button
                    onClick={() => handleStop(f.id)}
                    className="text-[10px] font-bold uppercase tracking-tighter bg-red-900/40 hover:bg-red-800/60 text-red-300 px-2 py-1 rounded-md border border-red-500/20 transition-colors"
                  >
                    Stop
                  </button>
                )}
              </div>
              <div className="text-xs text-gray-500 relative z-10 font-mono">{f.sourceUrl} → {f.destIp}:{f.destPort}</div>
              {f.isRunning && <div className="relative z-10 pt-2"><MetricsTile id={f.id} stats={f.lastStats} lastMessage={lastMessage} /></div>}
            </motion.div>
          ))}
        </div>
      </section>
    </div>
  );
}
