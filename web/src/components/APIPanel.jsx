import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Terminal, Play, ChevronDown, ChevronRight, Copy } from 'lucide-react';
import { toast } from 'sonner';
import BentoCard from './ui/BentoCard';
import { apiRequestDetailed } from '../api';

// ── Endpoint catalogue ─────────────────────────────────────────────────────────
const ENDPOINTS = [
  // Health
  {
    id: 'health-get',
    domain: 'Health',
    method: 'GET',
    path: '/health',
    desc: 'System telemetry: uptime, CPU%, memory, stream count',
    pathParams: [],
    pathDefaults: {},
    queryParams: [],
    queryDefaults: {},
    body: null,
  },

  // Streams
  {
    id: 'streams-list',
    domain: 'Streams',
    method: 'GET',
    path: '/streams',
    desc: 'List all active SRT encoders',
    pathParams: [],
    pathDefaults: {},
    queryParams: [],
    queryDefaults: {},
    body: null,
  },
  {
    id: 'streams-create',
    domain: 'Streams',
    method: 'POST',
    path: '/streams',
    desc: 'Create and start a new SRT encoder',
    pathParams: [],
    pathDefaults: {},
    queryParams: [],
    queryDefaults: {},
    body: {
      id: 'enc-1',
      input: 'srt://0.0.0.0:4200?mode=listener',
      host: '10.67.18.29',
      port: 9999,
      videoBitrate: '8M',
      audioBitrate: '192k',
      videoCodec: 'libx264',
      audioCodec: 'aac',
    },
  },
  {
    id: 'streams-get',
    domain: 'Streams',
    method: 'GET',
    path: '/streams/:id',
    desc: 'Get a specific encoder by ID',
    pathParams: ['id'],
    pathDefaults: { id: 'enc-1' },
    queryParams: [],
    queryDefaults: {},
    body: null,
  },
  {
    id: 'streams-delete',
    domain: 'Streams',
    method: 'DELETE',
    path: '/streams/:id',
    desc: 'Stop and remove an encoder',
    pathParams: ['id'],
    pathDefaults: { id: 'enc-1' },
    queryParams: [],
    queryDefaults: {},
    body: null,
  },

  // Transcode
  {
    id: 'transcode-presets',
    domain: 'Transcode',
    method: 'GET',
    path: '/transcode/presets',
    desc: 'List interlace transformation presets (pal, ntsc, hfr-pal, deinterlace)',
    pathParams: [],
    pathDefaults: {},
    queryParams: [],
    queryDefaults: {},
    body: null,
  },
  {
    id: 'transcode-broadcast-presets',
    domain: 'Transcode',
    method: 'GET',
    path: '/transcode/broadcast-presets',
    desc: 'Get 64 output format slots from config/presets.json',
    pathParams: [],
    pathDefaults: {},
    queryParams: [],
    queryDefaults: {},
    body: null,
  },
  {
    id: 'transcode-list',
    domain: 'Transcode',
    method: 'GET',
    path: '/transcode',
    desc: 'List active transcoders',
    pathParams: [],
    pathDefaults: {},
    queryParams: [],
    queryDefaults: {},
    body: null,
  },
  {
    id: 'transcode-create',
    domain: 'Transcode',
    method: 'POST',
    path: '/transcode',
    desc: 'Create an interlace transcoder',
    pathParams: [],
    pathDefaults: {},
    queryParams: [],
    queryDefaults: {},
    body: {
      id: 'tc-1',
      input: 'srt://10.67.18.29:4200',
      transcodePreset: 'pal',
      host: '10.67.18.29',
      port: 9999,
    },
  },
  {
    id: 'transcode-delete',
    domain: 'Transcode',
    method: 'DELETE',
    path: '/transcode/:id',
    desc: 'Stop and remove a transcoder',
    pathParams: ['id'],
    pathDefaults: { id: 'tc-1' },
    queryParams: [],
    queryDefaults: {},
    body: null,
  },

  // Multicast
  {
    id: 'multicast-config',
    domain: 'Multicast',
    method: 'GET',
    path: '/multicast/config',
    desc: 'Return NIC, subnet, address and TTL config',
    pathParams: [],
    pathDefaults: {},
    queryParams: [],
    queryDefaults: {},
    body: null,
  },
  {
    id: 'multicast-list',
    domain: 'Multicast',
    method: 'GET',
    path: '/multicast/forward',
    desc: 'List active forwarders',
    pathParams: [],
    pathDefaults: {},
    queryParams: [],
    queryDefaults: {},
    body: null,
  },
  {
    id: 'multicast-create',
    domain: 'Multicast',
    method: 'POST',
    path: '/multicast/forward',
    desc: 'Create a multicast forwarder (must be in 239.100.25.0/26)',
    pathParams: [],
    pathDefaults: {},
    queryParams: [],
    queryDefaults: {},
    body: {
      id: 'fwd-1',
      sourceUrl: 'srt://10.67.18.29:9999',
      destIp: '239.100.25.30',
      destPort: 5000,
      nic: 'eno2',
      ttl: 16,
    },
  },
  {
    id: 'multicast-delete',
    domain: 'Multicast',
    method: 'DELETE',
    path: '/multicast/forward/:id',
    desc: 'Stop and remove a forwarder',
    pathParams: ['id'],
    pathDefaults: { id: 'fwd-1' },
    queryParams: [],
    queryDefaults: {},
    body: null,
  },

  // Analyse
  {
    id: 'analyse-probe',
    domain: 'Analyse',
    method: 'GET',
    path: '/analyse',
    desc: 'One-shot ffprobe scan of a URL (pass ?url=…)',
    pathParams: [],
    pathDefaults: {},
    queryParams: ['url'],
    queryDefaults: { url: 'srt://10.67.18.29:9999' },
    body: null,
  },
  {
    id: 'analyse-list',
    domain: 'Analyse',
    method: 'GET',
    path: '/analyse',
    desc: 'List active continuous analysers (no ?url param)',
    pathParams: [],
    pathDefaults: {},
    queryParams: [],
    queryDefaults: {},
    body: null,
  },
  {
    id: 'analyse-start',
    domain: 'Analyse',
    method: 'POST',
    path: '/analyse/start',
    desc: 'Start continuous TS monitoring',
    pathParams: [],
    pathDefaults: {},
    queryParams: [],
    queryDefaults: {},
    body: {
      id: 'an-1',
      url: 'srt://10.67.18.29:9999',
      interval: 5000,
    },
  },
  {
    id: 'analyse-delete',
    domain: 'Analyse',
    method: 'DELETE',
    path: '/analyse/:id',
    desc: 'Stop an analyser',
    pathParams: ['id'],
    pathDefaults: { id: 'an-1' },
    queryParams: [],
    queryDefaults: {},
    body: null,
  },

  // ETR290
  {
    id: 'etr290-list',
    domain: 'ETR290',
    method: 'GET',
    path: '/etr290',
    desc: 'List active ETR290 monitors',
    pathParams: [],
    pathDefaults: {},
    queryParams: [],
    queryDefaults: {},
    body: null,
  },
  {
    id: 'etr290-start',
    domain: 'ETR290',
    method: 'POST',
    path: '/etr290/start',
    desc: 'Start an ETR290 confidence monitor',
    pathParams: [],
    pathDefaults: {},
    queryParams: [],
    queryDefaults: {},
    body: {
      id: 'etr-1',
      url: 'srt://10.67.18.29:9999',
    },
  },
  {
    id: 'etr290-get',
    domain: 'ETR290',
    method: 'GET',
    path: '/etr290/:id',
    desc: 'Get ETR290 monitor state',
    pathParams: ['id'],
    pathDefaults: { id: 'etr-1' },
    queryParams: [],
    queryDefaults: {},
    body: null,
  },
  {
    id: 'etr290-delete',
    domain: 'ETR290',
    method: 'DELETE',
    path: '/etr290/:id',
    desc: 'Stop an ETR290 monitor',
    pathParams: ['id'],
    pathDefaults: { id: 'etr-1' },
    queryParams: [],
    queryDefaults: {},
    body: null,
  },

  // Pipelines
  {
    id: 'pipeline-create',
    domain: 'Pipeline',
    method: 'POST',
    path: '/pipeline',
    desc: 'Create a linked ingest → transcode → forward pipeline atomically',
    pathParams: [],
    pathDefaults: {},
    queryParams: [],
    queryDefaults: {},
    body: {
      id: 'pl-1',
      input: 'srt://0.0.0.0:4200?mode=listener',
      srtHost: '10.67.18.29',
      srtPort: 9999,
      transcodePreset: 'pal',
      enableForward: false,
      multicastDestIp: '239.100.25.30',
      multicastPort: 5000,
    },
  },

  // SCTE-35
  {
    id: 'scte35-splice',
    domain: 'SCTE-35',
    method: 'POST',
    path: '/scte35/splice',
    desc: 'Build a SCTE-35 splice insert payload',
    pathParams: [],
    pathDefaults: {},
    queryParams: [],
    queryDefaults: {},
    body: {
      spliceEventId: 1001,
      duration: 30,
      pts: 0,
      programId: 1,
    },
  },
];

// ── Helpers ────────────────────────────────────────────────────────────────────
const METHOD_COLORS = {
  GET:    'bg-green-500/20  text-green-300  border-green-500/30',
  POST:   'bg-blue-500/20   text-blue-300   border-blue-500/30',
  DELETE: 'bg-red-500/20    text-red-300    border-red-500/30',
  PUT:    'bg-amber-500/20  text-amber-300  border-amber-500/30',
  PATCH:  'bg-purple-500/20 text-purple-300 border-purple-500/30',
};

function MethodBadge({ method }) {
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold border font-mono ${METHOD_COLORS[method] || 'bg-gray-500/20 text-gray-300 border-gray-500/30'}`}>
      {method}
    </span>
  );
}

function groupByDomain(endpoints) {
  return endpoints.reduce((acc, ep) => {
    if (!acc[ep.domain]) acc[ep.domain] = [];
    acc[ep.domain].push(ep);
    return acc;
  }, {});
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function APIPanel() {
  const [selected, setSelected] = useState(null);
  const [pathValues, setPathValues] = useState({});
  const [queryValues, setQueryValues] = useState({});
  const [bodyText, setBodyText] = useState('');
  const [response, setResponse] = useState(null);
  const [loading, setLoading] = useState(false);
  const [openDomains, setOpenDomains] = useState(() => {
    const all = {};
    ENDPOINTS.forEach(e => { all[e.domain] = true; });
    return all;
  });
  const responseRef = useRef(null);

  const grouped = groupByDomain(ENDPOINTS);

  function selectEndpoint(ep) {
    setSelected(ep);
    setPathValues(Object.fromEntries(ep.pathParams.map(p => [p, ep.pathDefaults?.[p] ?? ''])));
    setQueryValues(Object.fromEntries(ep.queryParams.map(p => [p, ep.queryDefaults?.[p] ?? ''])));
    setBodyText(ep.body ? JSON.stringify(ep.body, null, 2) : '');
    setResponse(null);
  }

  function buildUrl(ep) {
    let path = ep.path;
    ep.pathParams.forEach(p => {
      path = path.replace(`:${p}`, encodeURIComponent(pathValues[p] || p));
    });
    const qp = ep.queryParams
      .filter(p => queryValues[p])
      .map(p => `${encodeURIComponent(p)}=${encodeURIComponent(queryValues[p])}`)
      .join('&');
    return path + (qp ? `?${qp}` : '');
  }

  async function run() {
    if (!selected) return;
    if (selected.method === 'DELETE') {
      const ok = window.confirm(`Confirm ${selected.method} ${buildUrl(selected)} ?`);
      if (!ok) return;
    }
    setLoading(true);
    setResponse(null);
    const url = buildUrl(selected);
    let requestBody;
    if (selected.body && bodyText.trim()) {
      try {
        requestBody = JSON.parse(bodyText); // validate
      } catch {
        toast.error('Invalid JSON in request body');
        setLoading(false);
        return;
      }
    }
    const start = Date.now();
    try {
      const res = await apiRequestDetailed(selected.method, url, requestBody);
      const elapsed = Date.now() - start;
      setResponse({ ok: res.ok, status: res.status, elapsed, data: res.data });
      setTimeout(() => responseRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
      if (res.ok) {
        toast.success(`${selected.method} ${url} → ${res.status}`, { duration: 3000 });
      } else {
        toast.error(`${res.status} ${selected.method} ${url}`, { duration: 5000 });
      }
    } catch (err) {
      setResponse({ ok: false, status: 0, elapsed: Date.now() - start, data: { error: err.message } });
      toast.error(err.message, { duration: 5000 });
    } finally {
      setLoading(false);
    }
  }

  function copyResponse() {
    if (!response) return;
    navigator.clipboard.writeText(
      typeof response.data === 'string' ? response.data : JSON.stringify(response.data, null, 2)
    );
    toast.info('Copied to clipboard');
  }

  function toggleDomain(domain) {
    setOpenDomains(d => ({ ...d, [domain]: !d[domain] }));
  }

  return (
    <div className="grid grid-cols-[280px_1fr] gap-4 h-full min-h-[calc(100vh-8rem)]">

      {/* ── Left: Endpoint list ───────────────────────────────────────────── */}
      <div className="flex flex-col gap-2 overflow-y-auto pr-1">
        {Object.entries(grouped).map(([domain, eps]) => (
          <div key={domain}>
            <button
              onClick={() => toggleDomain(domain)}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-widest text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
            >
              {openDomains[domain]
                ? <ChevronDown className="w-3 h-3" />
                : <ChevronRight className="w-3 h-3" />}
              {domain}
              <span className="ml-auto text-[10px] text-gray-600">{eps.length}</span>
            </button>
            <AnimatePresence initial={false}>
              {openDomains[domain] && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="overflow-hidden"
                >
                  {eps.map(ep => (
                    <button
                      key={ep.id}
                      onClick={() => selectEndpoint(ep)}
                      className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-all duration-150 mb-0.5
                        ${selected?.id === ep.id
                          ? 'bg-neon-cyan/10 border border-neon-cyan/20'
                          : 'hover:bg-white/5 border border-transparent'}`}
                    >
                      <MethodBadge method={ep.method} />
                      <span className="font-mono text-[11px] text-gray-300 truncate flex-1">
                        {ep.path}
                      </span>
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))}
      </div>

      {/* ── Right: Detail + runner ────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 overflow-y-auto">
        {!selected ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-gray-600">
            <Terminal className="w-12 h-12 opacity-30" />
            <p className="text-sm">Select an endpoint to run it</p>
          </div>
        ) : (
          <>
            {/* Header */}
            <BentoCard
              icon={Terminal}
              title="API Explorer"
              accent="cyan"
            >
              <div className="flex items-start gap-3 mb-4">
                <MethodBadge method={selected.method} />
                <code className="font-mono text-sm text-neon-cyan break-all">{selected.path}</code>
              </div>
              <p className="text-xs text-gray-400 mb-4">{selected.desc}</p>

              {/* Path Params */}
              {selected.pathParams.length > 0 && (
                <div className="mb-4">
                  <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-2">Path Parameters</p>
                  <div className="flex flex-col gap-2">
                    {selected.pathParams.map(p => (
                      <div key={p} className="flex items-center gap-3">
                        <span className="font-mono text-[11px] text-amber-300 w-24 shrink-0">:{p}</span>
                        <input
                          value={pathValues[p] || ''}
                          onChange={e => setPathValues(v => ({ ...v, [p]: e.target.value }))}
                          placeholder={`Enter ${p}…`}
                          className="flex-1 bg-black/30 border border-white/10 rounded-lg px-3 py-1.5 font-mono text-xs text-white placeholder-gray-600 focus:outline-none focus:border-neon-cyan/40"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Query Params */}
              {selected.queryParams.length > 0 && (
                <div className="mb-4">
                  <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-2">Query Parameters</p>
                  <div className="flex flex-col gap-2">
                    {selected.queryParams.map(p => (
                      <div key={p} className="flex items-center gap-3">
                        <span className="font-mono text-[11px] text-green-300 w-24 shrink-0">?{p}</span>
                        <input
                          value={queryValues[p] || ''}
                          onChange={e => setQueryValues(v => ({ ...v, [p]: e.target.value }))}
                          placeholder={`Value for ${p}…`}
                          className="flex-1 bg-black/30 border border-white/10 rounded-lg px-3 py-1.5 font-mono text-xs text-white placeholder-gray-600 focus:outline-none focus:border-neon-cyan/40"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Body */}
              {selected.body !== null && (
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] uppercase tracking-widest text-gray-500">Request Body (JSON)</p>
                    <button
                      onClick={() => setBodyText(JSON.stringify(selected.body, null, 2))}
                      className="text-[10px] text-gray-500 hover:text-neon-cyan transition-colors"
                    >
                      Reset to default
                    </button>
                  </div>
                  <textarea
                    value={bodyText}
                    onChange={e => setBodyText(e.target.value)}
                    rows={Math.min(20, bodyText.split('\n').length + 1)}
                    spellCheck={false}
                    className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 font-mono text-xs text-white placeholder-gray-600 focus:outline-none focus:border-neon-cyan/40 resize-none"
                  />
                </div>
              )}

              {/* Preview URL + Run */}
              <div className="flex items-center gap-3">
                <code className="flex-1 font-mono text-[11px] text-gray-400 bg-black/30 rounded-lg px-3 py-1.5 truncate border border-white/5">
                  {buildUrl(selected)}
                </code>
                <button
                  onClick={run}
                  disabled={loading}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-neon-cyan/20 border border-neon-cyan/30 text-neon-cyan text-sm font-semibold hover:bg-neon-cyan/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Play className="w-4 h-4" strokeWidth={2} />
                  {loading ? 'Running…' : 'Run'}
                </button>
              </div>
            </BentoCard>

            {/* Response */}
            <AnimatePresence>
              {response && (
                <motion.div
                  ref={responseRef}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                >
                  <BentoCard
                    icon={Terminal}
                    title="Response"
                    accent={response.ok ? 'green' : 'red'}
                  >
                    <div className="flex items-center gap-3 mb-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold border font-mono
                        ${response.ok
                          ? 'bg-green-500/20 text-green-300 border-green-500/30'
                          : 'bg-red-500/20 text-red-300 border-red-500/30'}`}>
                        {response.status}
                      </span>
                      <span className="text-[11px] text-gray-500 font-mono">{response.elapsed}ms</span>
                      <button
                        onClick={copyResponse}
                        className="ml-auto flex items-center gap-1.5 text-[11px] text-gray-500 hover:text-neon-cyan transition-colors"
                      >
                        <Copy className="w-3 h-3" />
                        Copy
                      </button>
                    </div>
                    <pre className="font-mono text-xs text-gray-300 bg-black/40 rounded-lg p-3 overflow-x-auto max-h-96 border border-white/5 whitespace-pre-wrap break-words">
                      {typeof response.data === 'string'
                        ? response.data
                        : JSON.stringify(response.data, null, 2)}
                    </pre>
                  </BentoCard>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}
      </div>
    </div>
  );
}
