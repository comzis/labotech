import React, { useMemo, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { C, Badge, Dot, PanelBox, SectionHead, Input } from './BroadcastUI';

function toUtc(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toISOString().replace('T', ' ').replace('Z', ' UTC');
}

function sevColor(sev) {
  if (sev === 'critical') return C.crit;
  if (sev === 'warning') return C.warn;
  return C.info;
}

function statusColor(status) {
  const map = {
    alarm: C.crit,
    error: C.crit,
    'no-signal': C.warn,
    failover: C.warn,
    started: C.ok,
    stopped: C.muted,
    info: C.info,
  };
  return map[status] || C.muted;
}

function formatPidHex(pid) {
  if (!Number.isFinite(Number(pid))) return null;
  return `0x${Number(pid).toString(16).toUpperCase().padStart(4, '0')}`;
}

function PidDisplay({ pid, pidHex }) {
  const dec = Number.isFinite(Number(pid)) ? Number(pid) : null;
  const hex = pidHex || (dec != null ? formatPidHex(dec) : null);
  if (dec == null && !hex) return <span style={{ color: C.muted }}>-</span>;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 8 }}>
      {dec != null ? <span style={{ color: C.text, fontFamily: "'Courier New',monospace" }}>{dec}</span> : null}
      {hex ? <span style={{ color: C.muted, fontFamily: "'Courier New',monospace", fontSize: 9 }}>{hex}</span> : null}
    </span>
  );
}

function extractPidEvidence(selected) {
  const ev = selected?.evidence || {};
  const etr = ev.etr || {};
  const directPid = Number.isFinite(Number(ev.pid)) ? Number(ev.pid) : null;
  const nestedPid = Number.isFinite(Number(etr.pid)) ? Number(etr.pid) : null;
  const normalizedHex = typeof ev.pidHex === 'string' ? ev.pidHex.toUpperCase() : null;
  const fromHex = normalizedHex && /^0X[0-9A-F]+$/.test(normalizedHex)
    ? parseInt(normalizedHex, 16)
    : null;
  const hasEtrContext = Boolean(
    ev.priority || etr.priority || ev.checkId || etr.checkId || etr.checkKey || ev.incidentId
  );
  const pid = directPid ?? nestedPid ?? fromHex ?? null;
  const pidHex = normalizedHex
    || etr.pidHex
    || (pid != null ? formatPidHex(pid) : null);
  const isPlaceholderZero = pid === 0 && (pidHex === '0x0000' || pidHex === '0X0000');
  const safePid = isPlaceholderZero && !hasEtrContext ? null : pid;
  const safePidHex = isPlaceholderZero && !hasEtrContext ? null : pidHex;
  return {
    pid: safePid,
    pidHex: safePidHex,
    priority: ev.priority || etr.priority || null,
    checkId: ev.checkId || etr.checkId || etr.checkKey || null,
    incidentId: ev.incidentId || null,
  };
}

export default function EventLogPanel({ events = [], onClear = () => {}, onClearGhost = () => {} }) {
  const [severityFilter, setSeverityFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [selectedRowKey, setSelectedRowKey] = useState(null);

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
    toast.success(`Exported ${events.length} event(s) as JSONL`, { duration: 2500 });
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
    toast.success(`Exported ${events.length} event(s) as CSV`, { duration: 2500 });
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
      .slice(0, 500)
      .map((e, idx) => ({
        ...e,
        __key: e.key || `${e.when || 'na'}-${e.id || 'system'}-${idx}`,
      }));
  }, [events, severityFilter, query]);
  const selected = useMemo(() => rows.find((r) => r.__key === selectedRowKey) || null, [rows, selectedRowKey]);
  const pidEvidence = useMemo(() => extractPidEvidence(selected), [selected]);

  return (
    <div style={{ fontFamily: "'Courier New',monospace", color: C.text }}>
      <PanelBox>
        <SectionHead
          icon={<ShieldCheck size={12} />}
          title="Alarm & Event Log"
          activeDotColor={C.err}
          right={<Badge label="LIVE" color={C.ok} small />}
        />

        <div style={{ padding: '8px 10px', borderBottom: `1px solid ${C.border}`, background: C.panel }}>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
            {['all', 'critical', 'warning', 'info'].map((s) => (
              <button
                key={s}
                onClick={() => setSeverityFilter(s)}
                style={{
                  border: `1px solid ${severityFilter === s ? C.cyan : C.border}`,
                  background: severityFilter === s ? `${C.cyan}12` : C.input,
                  color: severityFilter === s ? C.cyan : C.muted,
                  borderRadius: 2,
                  padding: '3px 8px',
                  fontSize: 9,
                  fontWeight: 800,
                  letterSpacing: '0.09em',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                }}
              >
                {s}
              </button>
            ))}

            <div style={{ marginLeft: 'auto', minWidth: 260 }}>
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter by instance/message..."
                mono
              />
            </div>

            <button
              onClick={onClear}
              style={{
                border: `1px solid ${C.border}`,
                background: 'transparent',
                color: C.muted,
                borderRadius: 2,
                padding: '4px 8px',
                fontSize: 9,
                cursor: 'pointer',
              }}
            >
              Clear
            </button>
            <button
              onClick={() => onClearGhost(selected)}
              disabled={!selected}
              title={selected ? 'Remove selected ghost/stale event' : 'Select an event first'}
              style={{
                border: `1px solid ${selected ? C.warn : C.border}`,
                background: 'transparent',
                color: selected ? C.warn : C.muted,
                borderRadius: 2,
                padding: '4px 8px',
                fontSize: 9,
                cursor: selected ? 'pointer' : 'not-allowed',
                opacity: selected ? 1 : 0.55,
              }}
            >
              Clear Ghost
            </button>

            <button
              onClick={exportJsonl}
              style={{
                border: `1px solid ${C.border}`,
                background: 'transparent',
                color: C.muted,
                borderRadius: 2,
                padding: '4px 8px',
                fontSize: 9,
                cursor: 'pointer',
              }}
            >
              Download JSONL
            </button>

            <button
              onClick={exportCsv}
              style={{
                border: `1px solid ${C.border}`,
                background: 'transparent',
                color: C.muted,
                borderRadius: 2,
                padding: '4px 8px',
                fontSize: 9,
                cursor: 'pointer',
              }}
            >
              Download CSV
            </button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 320px' : '1fr', minHeight: 360 }}>
          <div style={{ maxHeight: '70vh', overflow: 'auto', background: C.panel }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
            <thead style={{ position: 'sticky', top: 0, background: C.panelAlt, zIndex: 2 }}>
              <tr style={{ borderBottom: `1px solid ${C.borderHi}` }}>
                <th style={{ textAlign: 'left', padding: '6px 8px', color: C.head, fontSize: 9 }}>Time (UTC)</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', color: C.head, fontSize: 9 }}>Instance</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', color: C.head, fontSize: 9 }}>Severity</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', color: C.head, fontSize: 9 }}>Status</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', color: C.head, fontSize: 9 }}>Event</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', color: C.head, fontSize: 9 }}>Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: '12px 8px', color: C.muted }}>
                    No events in current filter.
                  </td>
                </tr>
              ) : (
                rows.map((e, idx) => {
                  const sev = sevColor(e.severity);
                  const stat = statusColor(e.status);
                  return (
                    <tr
                      key={e.__key}
                      onClick={() => setSelectedRowKey(e.__key)}
                      style={{
                        borderBottom: `1px solid ${C.border}`,
                        background: selectedRowKey === e.__key ? `${C.cyan}10` : (idx % 2 ? `${C.panelAlt}66` : 'transparent'),
                        cursor: 'pointer',
                      }}
                    >
                      <td
                        style={{
                          padding: '6px 8px',
                          fontFamily: "'Courier New',monospace",
                          color: C.muted,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {toUtc(e.when)}
                      </td>
                      <td style={{ padding: '6px 8px', fontFamily: "'Courier New',monospace", color: C.text }}>{e.id}</td>
                      <td style={{ padding: '6px 8px' }}>
                        <Badge label={String(e.severity || 'info')} color={sev} small />
                      </td>
                      <td style={{ padding: '6px 8px', color: stat, textTransform: 'uppercase' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                          <Dot color={stat} size={6} glow={false} />
                          {String(e.status || '')}
                        </span>
                      </td>
                      <td style={{ padding: '6px 8px', color: C.text }}>{e.title}</td>
                      <td style={{ padding: '6px 8px', color: C.muted }}>{e.details || '-'}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
          </div>
          {selected && (
            <div style={{ borderLeft: `1px solid ${C.border}`, background: C.panelAlt, padding: '10px 12px', display: 'grid', gap: 10 }}>
              <SectionHead title="Event QoS Detail" icon="🧭" right={<Badge label={String(selected.severity || 'info')} color={sevColor(selected.severity)} small />} />
              <div style={{ border: `1px solid ${C.border}`, borderRadius: 2, background: C.panel, padding: 8 }}>
                <div style={{ fontSize: 9, color: C.head, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>Timestamps</div>
                <div style={{ fontSize: 10, color: C.text }}>{toUtc(selected.when)}</div>
              </div>
              <div style={{ border: `1px solid ${C.border}`, borderRadius: 2, background: C.panel, padding: 8 }}>
                <div style={{ fontSize: 9, color: C.head, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>Impact Summary</div>
                <div style={{ fontSize: 10, color: C.text }}>{selected.title || '-'}</div>
                <div style={{ fontSize: 10, color: C.muted, marginTop: 4 }}>{selected.details || '-'}</div>
              </div>
              <div style={{ border: `1px solid ${C.border}`, borderRadius: 2, background: C.panel, padding: 8 }}>
                <div style={{ fontSize: 9, color: C.head, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>PID / ETR Evidence</div>
                <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', rowGap: 4, fontSize: 10 }}>
                  <span style={{ color: C.muted }}>PID</span>
                  <PidDisplay pid={pidEvidence.pid} pidHex={pidEvidence.pidHex} />
                  <span style={{ color: C.muted }}>Priority</span>
                  <span style={{ color: C.text }}>{pidEvidence.priority || '-'}</span>
                  <span style={{ color: C.muted }}>Check ID</span>
                  <span style={{ color: C.text, fontFamily: "'Courier New',monospace" }}>{pidEvidence.checkId || '-'}</span>
                  <span style={{ color: C.muted }}>Incident ID</span>
                  <span style={{ color: C.text, fontFamily: "'Courier New',monospace" }}>{pidEvidence.incidentId || '-'}</span>
                </div>
              </div>
              <div style={{ border: `1px solid ${C.border}`, borderRadius: 2, background: C.panel, padding: 8 }}>
                <div style={{ fontSize: 9, color: C.head, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>DVB / SI Evidence</div>
                <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', rowGap: 4, fontSize: 10 }}>
                  <span style={{ color: C.muted }}>NIT / SDT / EIT / TDT</span>
                  <span style={{ color: C.text }}>
                    {selected?.evidence?.siCompliance
                      ? `NIT ${String(selected.evidence.siCompliance.nit)} · SDT ${String(selected.evidence.siCompliance.sdt)} · EIT ${String(selected.evidence.siCompliance.eitPf)} · TDT ${String(selected.evidence.siCompliance.tdt)}`
                      : '-'}
                  </span>
                  <span style={{ color: C.muted }}>SI intervals</span>
                  <span style={{ color: C.text, fontFamily: "'Courier New',monospace" }}>
                    {selected?.evidence?.siIntervalsSec ? JSON.stringify(selected.evidence.siIntervalsSec) : '-'}
                  </span>
                  <span style={{ color: C.muted }}>DVB health</span>
                  <span style={{ color: C.text }}>
                    {selected?.evidence?.dvb?.health
                      ? `${selected.evidence.dvb.health.score ?? '-'} / 100 (${selected.evidence.dvb.health.severity || '-'})`
                      : '-'}
                  </span>
                </div>
              </div>
              <div style={{ border: `1px solid ${C.border}`, borderRadius: 2, background: C.panel, padding: 8 }}>
                <div style={{ fontSize: 9, color: C.head, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>Raw Event Data</div>
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 9, color: C.muted, maxHeight: 180, overflow: 'auto' }}>
                  {JSON.stringify(selected, null, 2)}
                </pre>
              </div>
              <button
                onClick={() => setSelectedRowKey(null)}
                style={{ border: `1px solid ${C.border}`, background: 'transparent', color: C.muted, borderRadius: 2, padding: '6px 8px', fontSize: 10, cursor: 'pointer' }}
              >
                Close detail
              </button>
            </div>
          )}
        </div>
      </PanelBox>
    </div>
  );
}
