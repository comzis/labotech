import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Activity, Radio, Network, Search, ShieldCheck } from 'lucide-react';
import { Toaster, toast } from 'sonner';
import StreamsPanel from './components/StreamsPanel';
import TranscodePanel from './components/TranscodePanel';
import MulticastPanel from './components/MulticastPanel';
import TSAnalyser from './components/TSAnalyser';
import ConfidenceMonitor from './components/ConfidenceMonitor';
import useWebSocket from './hooks/useWebSocket';

const TABS = [
  { id: 'streams',    label: 'Streams',    icon: Activity    },
  { id: 'transcode',  label: 'Transcode',  icon: Radio       },
  { id: 'multicast',  label: 'Multicast',  icon: Network     },
  { id: 'analyse',    label: 'TS Analyser',icon: Search      },
  { id: 'confidence', label: 'Confidence', icon: ShieldCheck },
];

export default function App() {
  const [tab, setTab] = useState('streams');
  const { connected, lastMessage } = useWebSocket();

  // ── Broadcast event toasts ──────────────────────────────────────────────────
  useEffect(() => {
    if (!lastMessage) return;
    const { type, id, message } = lastMessage;
    switch (type) {
      case 'started':
        toast.success(`Stream ${id} started`, { duration: 4000 });
        break;
      case 'stopped':
      case 'transcode_stopped':
      case 'multicast_stopped':
        toast.info(`${id} stopped`, { duration: 4000 });
        break;
      case 'error':
        toast.error(`${id}: ${message}`, { duration: 8000 });
        break;
      case 'etr290_alarm':
        if (lastMessage.priority === 'p1') {
          toast.error(`ETR290 P1: ${lastMessage.label}`, { duration: 6000 });
        }
        break;
      case 'switched':
        toast.warning(`${id}: failover activated`, { duration: 6000 });
        break;
      default:
        break;
    }
  }, [lastMessage]);

  return (
    <div className="min-h-screen bg-midnight-base text-gray-200 font-sans tracking-tight relative overflow-hidden flex flex-col">
      {/* Sonner toast container — top-right, broadcast-style */}
      <Toaster
        position="top-right"
        theme="dark"
        richColors
        toastOptions={{ style: { fontFamily: 'monospace', fontSize: '12px' } }}
      />

      {/* Animated Mesh Gradient Orbs */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-neon-cyan/10 rounded-full blur-[120px] mix-blend-screen animate-float" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-neon-purple/10 rounded-full blur-[120px] mix-blend-screen animate-float" style={{ animationDelay: '2s' }} />

      {/* Floating Glass Header */}
      <header className="fixed top-0 w-full z-50 bg-midnight-glass backdrop-blur-xl border-b border-white/5">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-neon-cyan to-neon-blue flex items-center justify-center shadow-glow">
              <Activity className="w-5 h-5 text-white" strokeWidth={1.5} />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tighter text-white leading-none">LABOTECH</h1>
              <span className="text-[10px] uppercase tracking-[0.2em] text-neon-cyan font-semibold">Broadcast Engine</span>
            </div>
          </div>

          {/* Navigation */}
          <nav className="hidden md:flex items-center gap-1 mx-8 bg-black/20 p-1 rounded-xl border border-white/5">
            {TABS.map(t => {
              const Icon = t.icon;
              const isActive = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`relative px-4 py-2 rounded-lg text-sm font-medium transition-all duration-300 flex items-center gap-2
                    ${isActive ? 'text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
                >
                  <Icon className="w-4 h-4" strokeWidth={isActive ? 2 : 1.5} />
                  {t.label}
                  {isActive && (
                    <motion.div
                      layoutId="activeTab"
                      className="absolute inset-0 bg-white/10 rounded-lg -z-10"
                      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                    />
                  )}
                </button>
              );
            })}
          </nav>

          {/* Connection status — EBU traffic-light: green nominal, red fault */}
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-semibold tracking-wider
            ${connected
              ? 'bg-green-500/10 border-green-500/20 text-green-400'
              : 'bg-red-500/10  border-red-500/20  text-red-400'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
            {connected ? 'ONLINE' : 'OFFLINE'}
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 mt-24 mb-12 max-w-7xl w-full mx-auto px-6 relative z-10">
        <div style={{ display: tab === 'streams'    ? 'block' : 'none' }}><StreamsPanel     lastMessage={lastMessage} /></div>
        <div style={{ display: tab === 'transcode'  ? 'block' : 'none' }}><TranscodePanel   lastMessage={lastMessage} /></div>
        <div style={{ display: tab === 'multicast'  ? 'block' : 'none' }}><MulticastPanel   lastMessage={lastMessage} /></div>
        <div style={{ display: tab === 'analyse'    ? 'block' : 'none' }}><TSAnalyser        lastMessage={lastMessage} /></div>
        <div style={{ display: tab === 'confidence' ? 'block' : 'none' }}><ConfidenceMonitor lastMessage={lastMessage} /></div>
      </main>
    </div>
  );
}
