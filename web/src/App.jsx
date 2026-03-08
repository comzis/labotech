import React, { useState } from 'react';
import StreamsPanel from './components/StreamsPanel';
import EncoderForm from './components/EncoderForm';
import TranscodePanel from './components/TranscodePanel';
import MulticastPanel from './components/MulticastPanel';
import TSAnalyser from './components/TSAnalyser';
import ConfidenceMonitor from './components/ConfidenceMonitor';
import useWebSocket from './hooks/useWebSocket';

const TABS = [
  { id: 'streams',    label: 'Streams' },
  { id: 'transcode',  label: 'Transcode' },
  { id: 'multicast',  label: 'Multicast' },
  { id: 'analyse',    label: 'TS Analyser' },
  { id: 'confidence', label: 'Confidence' },
];

export default function App() {
  const [tab, setTab] = useState('streams');
  const { connected, lastMessage } = useWebSocket();

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="bg-gray-900 border-b border-gray-800 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xl font-bold tracking-tight text-white">📡 Labotech</span>
          <span className="text-xs text-gray-500">Broadcast Encoder</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
          <span className={connected ? 'text-green-400' : 'text-red-400'}>
            {connected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
      </header>

      {/* Tab bar */}
      <nav className="bg-gray-900 border-b border-gray-800 px-6">
        <div className="flex gap-1">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-sm transition-colors border-b-2 ${
                tab === t.id
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-gray-400 hover:text-gray-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </nav>

      {/* Content */}
      <main className="flex-1 p-6">
        {tab === 'streams'    && <StreamsPanel lastMessage={lastMessage} />}
        {tab === 'transcode'  && <TranscodePanel lastMessage={lastMessage} />}
        {tab === 'multicast'  && <MulticastPanel lastMessage={lastMessage} />}
        {tab === 'analyse'    && <TSAnalyser />}
        {tab === 'confidence' && <ConfidenceMonitor />}
      </main>
    </div>
  );
}
