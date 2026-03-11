import React, { useMemo, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import BentoCard from './ui/BentoCard';

function toUtc(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toISOString().replace('T', ' ').replace('Z', ' UTC');
}

function pillClass(sev) {
  if (sev === 'critical') return 'bg-red-900/30 border-red-500/40 text-red-300';
  if (sev === 'warning') return 'bg-amber-900/30 border-amber-500/40 text-amber-300';
  return 'bg-sky-900/30 border-sky-500/40 text-sky-300';
}

function statusClass(status) {
  const map = {
    alarm: 'text-red-300',
    error: 'text-red-300',
    'no-signal': 'text-amber-300',
    failover: 'text-amber-300',
    started: 'text-green-300',
    stopped: 'text-gray-500',
    info: 'text-sky-300',
  };
  return map[status] || 'text-gray-400';
}

export default function EventLogPanel({ events = [], onClear = () => {} }) {
  const [severityFilter, setSeverityFilter] = useState('all');
  const [query, setQuery] = useState('');

  const exportJsonl = () => {
    const lines = events.map((e) => JSON.stringify(e)).join('\n');
    const blob = new Blob([lines ? `${lines}\n` : ''], { type: 'application/jsonl;charset=utf-8' });
    const href = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().replace(/[:]/g, '-');
    const a = document.createElement('a');
    a.href = href;
    a.download = `labotech-events-${stamp}.jsonl`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(href);
  };

  const exportCsv = () => {
    const headers = ['time_utc', 'instance', 'severity', 'status', 'event', 'details', 'type'];
    const esc = (v) => {
      const s = String(v ?? '');
      return `"${s.replace(/"/g, '""')}"`;
    };
    const rowsCsv = events.map((e) => {
      const time = toUtc(e.when);
      return [
        esc(time),
        esc(e.id),
        esc(e.severity),
        esc(e.status),
        esc(e.title),
        esc(e.details),
        esc(e.type),
      ].join(',');
    });
    const csv = `${headers.join(',')}\n${rowsCsv.join('\n')}${rowsCsv.length ? '\n' : ''}`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const href = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().replace(/[:]/g, '-');
    const a = document.createElement('a');
    a.href = href;
    a.download = `labotech-events-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(href);
  };

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...events]
      .reverse()
      .filter((e) => severityFilter === 'all' || e.severity === severityFilter)
      .filter((e) => {
        if (!q) return true;
        return (
          String(e.id || '').toLowerCase().includes(q) ||
          String(e.title || '').toLowerCase().includes(q) ||
          String(e.details || '').toLowerCase().includes(q) ||
          String(e.status || '').toLowerCase().includes(q)
        );
      })
      .slice(0, 500);
  }, [events, severityFilter, query]);

  return (
    <div className="space-y-6 font-sans">
      <BentoCard icon={ShieldCheck} title="Alarm & Event Log">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {['all', 'critical', 'warning', 'info'].map((s) => (
            <button
              key={s}
              onClick={() => setSeverityFilter(s)}
              className={`text-xs px-2 py-1 rounded border ${
                severityFilter === s
                  ? 'border-neon-cyan/50 text-neon-cyan bg-neon-cyan/10'
                  : 'border-white/10 text-gray-400 bg-black/20'
              }`}
            >
              {s.toUpperCase()}
            </button>
          ))}
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by instance/message..."
            className="ml-auto min-w-[240px] bg-black/30 border border-white/10 rounded px-2 py-1.5 text-xs text-gray-300"
          />
          <button
            onClick={onClear}
            className="text-xs px-2 py-1 rounded border border-white/10 text-gray-500 hover:text-red-400"
          >
            Clear
          </button>
          <button
            onClick={exportJsonl}
            className="text-xs px-2 py-1 rounded border border-white/10 text-gray-400 hover:text-neon-cyan"
          >
            Download JSONL
          </button>
          <button
            onClick={exportCsv}
            className="text-xs px-2 py-1 rounded border border-white/10 text-gray-400 hover:text-neon-cyan"
          >
            Download CSV
          </button>
        </div>

        <div className="rounded-lg border border-white/10 bg-black/20 overflow-auto max-h-[70vh]">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-black/70 backdrop-blur">
              <tr className="text-gray-500 border-b border-white/10">
                <th className="text-left py-2 px-2">Time (UTC)</th>
                <th className="text-left py-2 px-2">Instance</th>
                <th className="text-left py-2 px-2">Severity</th>
                <th className="text-left py-2 px-2">Status</th>
                <th className="text-left py-2 px-2">Event</th>
                <th className="text-left py-2 px-2">Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-4 px-2 text-gray-500">No events in current filter.</td>
                </tr>
              ) : (
                rows.map((e) => (
                  <tr key={e.key} className="border-b border-white/5 align-top">
                    <td className="py-2 px-2 font-mono text-gray-400 whitespace-nowrap">{toUtc(e.when)}</td>
                    <td className="py-2 px-2 font-mono text-gray-300">{e.id}</td>
                    <td className="py-2 px-2">
                      <span className={`inline-block text-[10px] uppercase px-1.5 py-0.5 rounded border ${pillClass(e.severity)}`}>
                        {e.severity}
                      </span>
                    </td>
                    <td className={`py-2 px-2 uppercase font-mono ${statusClass(e.status)}`}>{e.status}</td>
                    <td className="py-2 px-2 text-gray-200">{e.title}</td>
                    <td className="py-2 px-2 text-gray-400">{e.details || '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </BentoCard>
    </div>
  );
}
