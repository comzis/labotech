import React, { useEffect, useState } from 'react';
import { Network, Settings2, Share2 } from 'lucide-react';
import { getMulticastConfig, getForwarders, startForwarder, stopForwarder } from '../api';
import MetricsTile from './MetricsTile';
import {
  C,
  PanelBox,
  SectionHead,
  Field,
  Input,
  Select,
  Badge,
  Dot,
} from './BroadcastUI';

const DEFAULTS = {
  id: '',
  sourceMode: 'rtp',
  sourceHost: '',
  sourcePort: '5000',
  destIp: '',
  destPort: '1234',
  engineerApproved: false,
};

function buildSourceUrl({ sourceMode, sourceHost, sourcePort }) {
  const cleanHost = String(sourceHost || '')
    .trim()
    .replace(/^[a-z][a-z0-9+\-.]*:\/\//i, '')
    .split('/')[0];
  const cleanPort = String(sourcePort || '').trim();
  if (!cleanHost || !cleanPort) return '';
  if (sourceMode === 'rtp') return `rtp://${cleanHost}:${cleanPort}`;
  if (sourceMode === 'srt') return `srt://${cleanHost}:${cleanPort}?mode=listener&latency=2000`;
  return `udp://${cleanHost}:${cleanPort}`;
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
    setForm((prev) => ({
      ...prev,
      // Keep destination blank until operator enters/chooses it explicitly.
      destIp: prev.destIp || '',
      engineerApproved: false,
    }));
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (lastMessage?.type === 'multicast_stopped') load();
  }, [lastMessage]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

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
        engineerApproved: form.engineerApproved === true,
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
    try {
      setError(null);
      await stopForwarder(id);
      load();
    } catch (err) {
      setError(err.message || 'Failed to stop forwarder');
    }
  };

  return (
    <div style={{ fontFamily: "'Courier New',monospace", color: C.text }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 8,
          borderBottom: `1px solid ${C.border}`,
          paddingBottom: 6,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Network size={16} color={C.ok} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.05em' }}>Forwarder Workflow</div>
            <div style={{ fontSize: 9, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              Network Distribution & Group Forwarding
            </div>
          </div>
        </div>

        <button
          onClick={() => setOpen((o) => !o)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            border: `1px solid ${open ? C.border : C.ok}`,
            background: open ? C.panel : `${C.ok}14`,
            color: open ? C.muted : C.ok,
            borderRadius: 2,
            padding: '6px 10px',
            fontSize: 10,
            fontWeight: 700,
            textTransform: 'uppercase',
            cursor: 'pointer',
          }}
        >
          {!open ? <Share2 size={12} /> : null}
          {open ? 'Cancel' : 'Deploy Forwarder'}
        </button>
      </div>

      {config && (
        <PanelBox style={{ marginBottom: 8 }}>
          <SectionHead
            icon={<Settings2 size={12} />}
            title="Interface Configuration"
            right={<Badge label={`${config.nic || 'nic'} up`} color={C.ok} small />}
          />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 8, padding: '8px 10px' }}>
            {[
              ['NIC', config.nic],
              ['Subnet', config.subnet],
              ['Default IP', config.address],
              ['TTL', config.ttl],
            ].map(([k, v]) => (
              <div key={k} style={{ border: `1px solid ${C.border}`, borderRadius: 2, background: C.input, padding: '6px 8px' }}>
                <div style={{ fontSize: 8, color: C.head, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{k}</div>
                <div style={{ fontSize: 10, color: C.ok, marginTop: 2 }}>{v || '-'}</div>
              </div>
            ))}
          </div>
        </PanelBox>
      )}

      {open && (
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, alignItems: 'start', marginBottom: 8 }}>
            <PanelBox>
              <SectionHead title="Source Configuration" />
              <div style={{ padding: '8px 10px', display: 'grid', gap: 8 }}>
                <Field label="Forwarder ID" required>
                  <Input value={form.id} onChange={(e) => set('id', e.target.value)} placeholder="fwd-main-a" mono />
                </Field>

                <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 110px', gap: 8 }}>
                  <Field label="Protocol">
                    <Select
                      value={form.sourceMode}
                      onChange={(e) => set('sourceMode', e.target.value)}
                      options={[
                        { value: 'rtp', label: 'RTP' },
                        { value: 'srt', label: 'SRT' },
                        { value: 'udp', label: 'UDP (Legacy)' },
                      ]}
                    />
                  </Field>
                  <Field label="Source Host / IP" required>
                    <Input value={form.sourceHost} onChange={(e) => set('sourceHost', e.target.value)} placeholder="Host / IP" mono />
                  </Field>
                  <Field label="Source Port" required>
                    <Input value={form.sourcePort} onChange={(e) => set('sourcePort', e.target.value)} placeholder="5000" mono />
                  </Field>
                </div>

                <div style={{ border: `1px solid ${C.border}`, borderRadius: 2, background: C.input, padding: '5px 8px', fontSize: 9, color: C.muted }}>
                  {buildSourceUrl(form) || 'Source URL preview'}
                </div>
              </div>
            </PanelBox>

            <PanelBox>
              <SectionHead title="Destination Configuration" />
              <div style={{ padding: '8px 10px', display: 'grid', gap: 8 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px', gap: 8 }}>
                  <Field label="Destination IP" required>
                    <Input value={form.destIp} onChange={(e) => set('destIp', e.target.value)} placeholder="Destination IP" mono />
                  </Field>
                  <Field label="Destination Port">
                    <Input value={form.destPort} onChange={(e) => set('destPort', e.target.value)} placeholder="1234" mono />
                  </Field>
                </div>

                <div style={{ fontSize: 9, color: C.warn }}>
                  Allowed destination is restricted to <span style={{ color: C.text }}>{config?.address || '239.100.25.29'}</span>.
                </div>

                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    border: `1px solid ${form.engineerApproved ? C.ok : C.border}`,
                    background: form.engineerApproved ? `${C.ok}10` : C.input,
                    borderRadius: 2,
                    padding: '6px 8px',
                    fontSize: 10,
                    color: form.engineerApproved ? C.ok : C.muted,
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={form.engineerApproved}
                    onChange={(e) => set('engineerApproved', e.target.checked)}
                    style={{ accentColor: C.ok }}
                  />
                  Engineer approval confirmed for forwarding start
                </label>
              </div>
            </PanelBox>

            <div style={{ paddingTop: 24 }}>
              <button
                type="submit"
                disabled={loading || !form.engineerApproved}
                style={{
                  border: `1px solid ${loading || !form.engineerApproved ? C.border : C.ok}`,
                  background: loading || !form.engineerApproved ? C.panel : `${C.ok}18`,
                  color: loading || !form.engineerApproved ? C.muted : C.ok,
                  borderRadius: 2,
                  padding: '10px 12px',
                  fontSize: 10,
                  fontWeight: 800,
                  textTransform: 'uppercase',
                  cursor: loading || !form.engineerApproved ? 'not-allowed' : 'pointer',
                  minWidth: 170,
                }}
              >
                {loading ? 'Initializing...' : 'Initiate Forwarder'}
              </button>
            </div>
          </div>
        </form>
      )}

      {error && (
        <div
          style={{
            marginBottom: 8,
            border: `1px solid ${C.err}`,
            background: `${C.err}14`,
            borderRadius: 2,
            padding: '6px 8px',
            fontSize: 10,
            color: C.err,
          }}
        >
          {error}
        </div>
      )}

      <PanelBox>
        <SectionHead
          title="Running Forwarders"
          right={<Badge label={`${forwarders.length} active`} color={forwarders.length > 0 ? C.ok : C.muted} small />}
        />

        {forwarders.length === 0 ? (
          <div style={{ padding: '12px 10px', color: C.muted, fontSize: 10 }}>
            No active forwarders - configure and deploy one.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8, padding: '8px 10px' }}>
            {forwarders.map((f) => (
              <div
                key={f.id}
                style={{
                  border: `1px solid ${C.border}`,
                  borderRadius: 2,
                  background: C.input,
                  padding: '8px 9px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Dot color={f.isRunning ? C.ok : C.muted} size={7} />
                    <span style={{ fontSize: 11, color: C.text }}>{f.id}</span>
                    <Badge label={f.isRunning ? 'running' : 'stopped'} color={f.isRunning ? C.ok : C.muted} small />
                  </div>
                  {f.isRunning && (
                    <button
                      onClick={() => handleStop(f.id)}
                      style={{
                        border: `1px solid ${C.err}`,
                        background: `${C.err}16`,
                        color: C.err,
                        borderRadius: 2,
                        padding: '3px 7px',
                        fontSize: 9,
                        textTransform: 'uppercase',
                        cursor: 'pointer',
                      }}
                    >
                      Stop
                    </button>
                  )}
                </div>

                <div style={{ fontSize: 9, color: C.muted, marginBottom: 6 }}>
                  {f.sourceUrl} → {f.destIp}:{f.destPort}
                </div>

                {f.isRunning && (
                  <div>
                    <MetricsTile id={f.id} stats={f.lastStats} lastMessage={lastMessage} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </PanelBox>
    </div>
  );
}
