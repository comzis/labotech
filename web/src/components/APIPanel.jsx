import React, { useMemo, useRef, useState } from "react";
import { Terminal, Play, ChevronDown, ChevronRight, Copy, Search, Link } from "lucide-react";
import { toast } from "sonner";
import { apiRequestDetailed } from "../api";
import { C, Badge, Field, Input, PanelBox, SectionHead } from "./BroadcastUI";

const METHOD_COLOR = {
  GET: C.ok,
  POST: C.info,
  PUT: C.warn,
  PATCH: C.purple,
  DELETE: C.err,
};

const ep = ({ id, domain, method, path, desc, pathParams = [], pathDefaults = {}, queryParams = [], queryDefaults = {}, body = null }) => ({
  id, domain, method, path, desc, pathParams, pathDefaults, queryParams, queryDefaults, body,
});

const ENDPOINTS = [
  ep({ id: "health-get", domain: "Health", method: "GET", path: "/health", desc: "System telemetry and process health." }),

  ep({ id: "streams-list", domain: "Streams", method: "GET", path: "/streams", desc: "List active stream instances." }),
  ep({
    id: "streams-create", domain: "Streams", method: "POST", path: "/streams", desc: "Create and start a stream.",
    body: { id: "stream-1", input: "srt://0.0.0.0:4200?mode=listener", host: "10.67.18.29", port: 9999, videoBitrate: "8M", audioBitrate: "192k", videoCodec: "libx264", audioCodec: "aac" },
  }),
  ep({ id: "streams-get", domain: "Streams", method: "GET", path: "/streams/:id", desc: "Read stream details by ID.", pathParams: ["id"], pathDefaults: { id: "stream-1" } }),
  ep({ id: "streams-delete", domain: "Streams", method: "DELETE", path: "/streams/:id", desc: "Stop and remove a stream.", pathParams: ["id"], pathDefaults: { id: "stream-1" } }),

  ep({ id: "transcode-presets", domain: "Transcode", method: "GET", path: "/transcode/presets", desc: "List interlace transformation presets." }),
  ep({ id: "transcode-broadcast-presets", domain: "Transcode", method: "GET", path: "/transcode/broadcast-presets", desc: "Get 64 preset slots." }),
  ep({ id: "transcode-list", domain: "Transcode", method: "GET", path: "/transcode", desc: "List active transcoders." }),
  ep({
    id: "transcode-create", domain: "Transcode", method: "POST", path: "/transcode", desc: "Create a transcoder.",
    body: { id: "tc-1", input: "srt://10.67.18.29:4200", transcodePreset: "pal", host: "10.67.18.29", port: 9999 },
  }),
  ep({ id: "transcode-get", domain: "Transcode", method: "GET", path: "/transcode/:id", desc: "Read transcoder details.", pathParams: ["id"], pathDefaults: { id: "tc-1" } }),
  ep({ id: "transcode-delete", domain: "Transcode", method: "DELETE", path: "/transcode/:id", desc: "Stop and remove a transcoder.", pathParams: ["id"], pathDefaults: { id: "tc-1" } }),

  ep({ id: "multicast-config", domain: "Multicast", method: "GET", path: "/multicast/config", desc: "Read multicast NIC/subnet config." }),
  ep({ id: "multicast-list", domain: "Multicast", method: "GET", path: "/multicast/forward", desc: "List active forwarders." }),
  ep({
    id: "multicast-create", domain: "Multicast", method: "POST", path: "/multicast/forward", desc: "Create a forwarder (239.100.25.0/26).",
    body: { id: "fwd-1", sourceUrl: "srt://10.67.18.29:9999", destIp: "239.100.25.30", destPort: 5000, nic: "eno2", ttl: 16 },
  }),
  ep({ id: "multicast-get", domain: "Multicast", method: "GET", path: "/multicast/forward/:id", desc: "Read one forwarder by ID.", pathParams: ["id"], pathDefaults: { id: "fwd-1" } }),
  ep({ id: "multicast-delete", domain: "Multicast", method: "DELETE", path: "/multicast/forward/:id", desc: "Stop and remove a forwarder.", pathParams: ["id"], pathDefaults: { id: "fwd-1" } }),

  ep({ id: "analyse-probe", domain: "Analyse", method: "GET", path: "/analyse", desc: "One-shot analysis (with ?url).", queryParams: ["url"], queryDefaults: { url: "srt://10.67.18.29:9999" } }),
  ep({ id: "analyse-list", domain: "Analyse", method: "GET", path: "/analyse", desc: "List active analysers (without ?url)." }),
  ep({ id: "analyse-start", domain: "Analyse", method: "POST", path: "/analyse/start", desc: "Start continuous TS monitoring.", body: { id: "an-1", url: "srt://10.67.18.29:9999", interval: 5000 } }),
  ep({ id: "analyse-get", domain: "Analyse", method: "GET", path: "/analyse/:id", desc: "Read analyser by ID.", pathParams: ["id"], pathDefaults: { id: "an-1" } }),
  ep({ id: "analyse-delete", domain: "Analyse", method: "DELETE", path: "/analyse/:id", desc: "Stop analyser.", pathParams: ["id"], pathDefaults: { id: "an-1" } }),

  ep({ id: "etr290-list", domain: "ETR290", method: "GET", path: "/etr290", desc: "List active ETR monitors." }),
  ep({ id: "etr290-profiles-list", domain: "ETR290", method: "GET", path: "/etr290/profiles", desc: "List saved ETR config profiles." }),
  ep({
    id: "etr290-profiles-save", domain: "ETR290", method: "POST", path: "/etr290/profiles", desc: "Save ETR profile.",
    body: { name: "strict-p1", description: "P1 strict for PCR/video", config: { includePids: [256, 257], excludePids: [], allowUnknownPid: false, thresholds: { pcr_acc: 2, pcr_disc: 1 } } },
  }),
  ep({ id: "etr290-profiles-delete", domain: "ETR290", method: "DELETE", path: "/etr290/profiles/:name", desc: "Delete ETR profile by name.", pathParams: ["name"], pathDefaults: { name: "strict-p1" } }),
  ep({
    id: "etr290-start", domain: "ETR290", method: "POST", path: "/etr290/start", desc: "Start ETR monitor.",
    body: { id: "etr-1", url: "srt://10.67.18.29:9999" },
  }),
  ep({ id: "etr290-get", domain: "ETR290", method: "GET", path: "/etr290/:id", desc: "Read ETR monitor status.", pathParams: ["id"], pathDefaults: { id: "etr-1" } }),
  ep({
    id: "etr290-config-update", domain: "ETR290", method: "PUT", path: "/etr290/:id/config", desc: "Apply runtime ETR tuning to a monitor.",
    pathParams: ["id"], pathDefaults: { id: "etr-1" },
    body: { profileName: "strict-p1", config: { includePids: [256], excludePids: [8191], allowUnknownPid: true, thresholds: { cc_error: 5 } } },
  }),
  ep({ id: "etr290-delete", domain: "ETR290", method: "DELETE", path: "/etr290/:id", desc: "Stop ETR monitor.", pathParams: ["id"], pathDefaults: { id: "etr-1" } }),

  ep({
    id: "pipeline-create", domain: "Pipeline", method: "POST", path: "/pipeline", desc: "Create ingest -> transcode -> forward pipeline atomically.",
    body: { id: "pl-1", input: "srt://0.0.0.0:4200?mode=listener", srtHost: "10.67.18.29", srtPort: 9999, transcodePreset: "pal", enableForward: false, multicastDestIp: "239.100.25.30", multicastPort: 5000 },
  }),

  ep({ id: "events-get", domain: "Events", method: "GET", path: "/api/events", desc: "Read runtime event log backlog." }),
  ep({ id: "events-clear", domain: "Events", method: "DELETE", path: "/api/events", desc: "Clear runtime event backlog." }),

  ep({
    id: "scte35-splice", domain: "SCTE-35", method: "POST", path: "/scte35/splice", desc: "Build SCTE-35 splice insert payload.",
    body: { spliceEventId: 1001, duration: 30, pts: 0, programId: 1 },
  }),
];

function MethodBadge({ method }) {
  const color = METHOD_COLOR[method] || C.muted;
  return <Badge label={method} color={color} small />;
}

function groupByDomain(endpoints) {
  return endpoints.reduce((acc, epCfg) => {
    if (!acc[epCfg.domain]) acc[epCfg.domain] = [];
    acc[epCfg.domain].push(epCfg);
    return acc;
  }, {});
}

function bodyByteSize(data) {
  try {
    const s = typeof data === "string" ? data : JSON.stringify(data);
    return new TextEncoder().encode(s || "").length;
  } catch (_) {
    return 0;
  }
}

function toCurl(method, url, body) {
  const base = `curl -X ${method} "http://localhost:4000${url}"`;
  if (!body) return base;
  const payload = JSON.stringify(body).replace(/'/g, "'\\''");
  return `${base} -H "Content-Type: application/json" --data '${payload}'`;
}

export default function APIPanel() {
  const [selected, setSelected] = useState(null);
  const [pathValues, setPathValues] = useState({});
  const [queryValues, setQueryValues] = useState({});
  const [bodyText, setBodyText] = useState("");
  const [response, setResponse] = useState(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [writesOnly, setWritesOnly] = useState(false);
  const [pretty, setPretty] = useState(true);
  const [history, setHistory] = useState([]);
  const [openDomains, setOpenDomains] = useState(() => {
    const all = {};
    ENDPOINTS.forEach((e) => { all[e.domain] = true; });
    return all;
  });
  const responseRef = useRef(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return ENDPOINTS.filter((e) => {
      if (writesOnly && e.method === "GET") return false;
      if (!q) return true;
      return [e.domain, e.method, e.path, e.desc, e.id].some((x) => String(x).toLowerCase().includes(q));
    });
  }, [search, writesOnly]);

  const grouped = useMemo(() => groupByDomain(filtered), [filtered]);

  function selectEndpoint(epCfg) {
    setSelected(epCfg);
    setPathValues(Object.fromEntries(epCfg.pathParams.map((p) => [p, epCfg.pathDefaults?.[p] ?? ""])));
    setQueryValues(Object.fromEntries(epCfg.queryParams.map((p) => [p, epCfg.queryDefaults?.[p] ?? ""])));
    setBodyText(epCfg.body ? JSON.stringify(epCfg.body, null, 2) : "");
    setResponse(null);
  }

  function buildUrl(epCfg) {
    let path = epCfg.path;
    epCfg.pathParams.forEach((p) => {
      path = path.replace(`:${p}`, encodeURIComponent(pathValues[p] || p));
    });
    const qp = epCfg.queryParams
      .filter((p) => queryValues[p])
      .map((p) => `${encodeURIComponent(p)}=${encodeURIComponent(queryValues[p])}`)
      .join("&");
    return path + (qp ? `?${qp}` : "");
  }

  async function copyText(text, okMessage) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(okMessage);
    } catch (_) {
      toast.error("Clipboard denied by browser.");
    }
  }

  async function run() {
    if (!selected) return;
    const url = buildUrl(selected);
    if (selected.method === "DELETE") {
      const ok = window.confirm(`Confirm ${selected.method} ${url} ?`);
      if (!ok) return;
    }

    let requestBody;
    if (selected.body && bodyText.trim()) {
      try {
        requestBody = JSON.parse(bodyText);
      } catch {
        toast.error("Invalid JSON in request body.");
        return;
      }
    }

    setLoading(true);
    setResponse(null);
    const start = Date.now();
    try {
      const res = await apiRequestDetailed(selected.method, url, requestBody);
      const elapsed = Date.now() - start;
      const payloadBytes = bodyByteSize(res.data);
      const result = { ok: res.ok, status: res.status, elapsed, bytes: payloadBytes, data: res.data, method: selected.method, url };
      setResponse(result);
      setHistory((prev) => [{ at: Date.now(), method: selected.method, url, status: res.status, ok: res.ok, elapsed }, ...prev].slice(0, 12));
      setTimeout(() => responseRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 30);
      if (res.ok) toast.success(`${selected.method} ${url} -> ${res.status}`);
      else toast.error(`${res.status} ${selected.method} ${url}`);
    } catch (err) {
      const elapsed = Date.now() - start;
      const result = { ok: false, status: 0, elapsed, bytes: 0, data: { error: err.message }, method: selected.method, url };
      setResponse(result);
      setHistory((prev) => [{ at: Date.now(), method: selected.method, url, status: 0, ok: false, elapsed }, ...prev].slice(0, 12));
      toast.error(err.message || "Request failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 10, minHeight: "calc(100vh - 8rem)", color: C.text }}>
      <PanelBox style={{ display: "flex", flexDirection: "column", minHeight: 300 }}>
        <SectionHead icon="🛰️" title="API Endpoints" right={<Badge label={`${filtered.length} routes`} color={C.cyan} small />} />
        <div style={{ padding: "8px 10px", borderBottom: `1px solid ${C.border}`, display: "grid", gap: 6 }}>
          <Field label="Search">
            <div style={{ position: "relative" }}>
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="path, method, domain..." mono style={{ paddingLeft: 26 }} />
              <Search size={12} style={{ position: "absolute", left: 8, top: 8, color: C.muted }} />
            </div>
          </Field>
          <button
            onClick={() => setWritesOnly((v) => !v)}
            style={{
              border: `1px solid ${writesOnly ? C.warn : C.border}`,
              background: writesOnly ? `${C.warn}11` : "transparent",
              color: writesOnly ? C.warn : C.muted,
              borderRadius: 2,
              padding: "5px 8px",
              fontSize: 10,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              cursor: "pointer",
            }}
          >
            {writesOnly ? "Write Endpoints Only" : "Show All Endpoints"}
          </button>
        </div>

        <div style={{ overflowY: "auto", padding: "8px 8px 10px" }}>
          {Object.entries(grouped).map(([domain, eps]) => (
            <div key={domain} style={{ marginBottom: 8 }}>
              <button
                onClick={() => setOpenDomains((d) => ({ ...d, [domain]: !d[domain] }))}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 6, background: C.panelAlt, border: `1px solid ${C.border}`, borderRadius: 2, color: C.head, padding: "5px 8px", cursor: "pointer", fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}
              >
                {openDomains[domain] ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                <span>{domain}</span>
                <span style={{ marginLeft: "auto", color: C.muted }}>{eps.length}</span>
              </button>
              {openDomains[domain] && (
                <div style={{ marginTop: 4, display: "grid", gap: 3 }}>
                  {eps.map((epCfg) => (
                    <button
                      key={epCfg.id}
                      onClick={() => selectEndpoint(epCfg)}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        border: `1px solid ${selected?.id === epCfg.id ? C.cyan : C.border}`,
                        background: selected?.id === epCfg.id ? `${C.cyan}12` : C.panel,
                        borderRadius: 2,
                        padding: "6px 8px",
                        cursor: "pointer",
                        display: "grid",
                        gap: 3,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <MethodBadge method={epCfg.method} />
                        <span style={{ color: C.cyan, fontFamily: "'Courier New',monospace", fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{epCfg.path}</span>
                      </div>
                      <span style={{ fontSize: 9, color: C.muted }}>{epCfg.desc}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </PanelBox>

      <div style={{ display: "grid", gap: 10, alignContent: "start" }}>
        {!selected ? (
          <PanelBox>
            <SectionHead icon="🧪" title="API Explorer" />
            <div style={{ padding: "30px 16px", color: C.muted, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              <Terminal size={18} />
              Select an endpoint from the left panel.
            </div>
          </PanelBox>
        ) : (
          <>
            <PanelBox>
              <SectionHead icon="🧪" title="API Explorer" right={<MethodBadge method={selected.method} />} />
              <div style={{ padding: 12, display: "grid", gap: 10 }}>
                <div style={{ border: `1px solid ${C.border}`, background: C.dim, borderRadius: 2, padding: "8px 10px", display: "grid", gap: 5 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Link size={12} color={C.muted} />
                    <span style={{ color: C.cyan, fontFamily: "'Courier New',monospace", fontSize: 11 }}>{selected.path}</span>
                  </div>
                  <div style={{ color: C.muted, fontSize: 10 }}>{selected.desc}</div>
                </div>

                {selected.pathParams.length > 0 && (
                  <div style={{ display: "grid", gap: 6 }}>
                    <div style={{ color: C.head, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 700 }}>Path Params</div>
                    {selected.pathParams.map((p) => (
                      <div key={p} style={{ display: "grid", gridTemplateColumns: "90px 1fr", alignItems: "center", gap: 6 }}>
                        <span style={{ color: C.warn, fontFamily: "'Courier New',monospace", fontSize: 10 }}>:{p}</span>
                        <Input value={pathValues[p] || ""} onChange={(e) => setPathValues((v) => ({ ...v, [p]: e.target.value }))} placeholder={`Enter ${p}`} mono />
                      </div>
                    ))}
                  </div>
                )}

                {selected.queryParams.length > 0 && (
                  <div style={{ display: "grid", gap: 6 }}>
                    <div style={{ color: C.head, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 700 }}>Query Params</div>
                    {selected.queryParams.map((p) => (
                      <div key={p} style={{ display: "grid", gridTemplateColumns: "90px 1fr", alignItems: "center", gap: 6 }}>
                        <span style={{ color: C.ok, fontFamily: "'Courier New',monospace", fontSize: 10 }}>?{p}</span>
                        <Input value={queryValues[p] || ""} onChange={(e) => setQueryValues((v) => ({ ...v, [p]: e.target.value }))} placeholder={`Value for ${p}`} mono />
                      </div>
                    ))}
                  </div>
                )}

                {selected.body !== null && (
                  <div style={{ display: "grid", gap: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div style={{ color: C.head, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 700 }}>Request Body (JSON)</div>
                      <button onClick={() => setBodyText(JSON.stringify(selected.body, null, 2))} style={{ border: `1px solid ${C.border}`, background: "transparent", color: C.muted, borderRadius: 2, padding: "3px 6px", fontSize: 9, cursor: "pointer" }}>Reset default</button>
                    </div>
                    <textarea
                      value={bodyText}
                      onChange={(e) => setBodyText(e.target.value)}
                      spellCheck={false}
                      rows={Math.min(20, bodyText.split("\n").length + 1)}
                      style={{ width: "100%", boxSizing: "border-box", resize: "vertical", minHeight: 120, background: C.input, border: `1px solid ${C.border}`, color: C.text, borderRadius: 2, padding: "8px 10px", fontFamily: "'Courier New',monospace", fontSize: 11, outline: "none" }}
                    />
                  </div>
                )}

                <div style={{ border: `1px solid ${C.border}`, borderRadius: 2, background: C.dim, padding: "7px 9px", fontFamily: "'Courier New',monospace", fontSize: 11, color: C.head }}>
                  {buildUrl(selected)}
                </div>

                <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                  <button
                    onClick={() => {
                      let parsed = null;
                      if (selected.body !== null && bodyText.trim()) {
                        try { parsed = JSON.parse(bodyText); } catch { parsed = null; }
                      }
                      copyText(toCurl(selected.method, buildUrl(selected), parsed), "cURL copied");
                    }}
                    style={{ border: `1px solid ${C.border}`, background: "transparent", color: C.muted, borderRadius: 2, padding: "6px 10px", fontSize: 10, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}
                  >
                    <Copy size={12} /> Copy cURL
                  </button>
                  <button
                    onClick={run}
                    disabled={loading}
                    style={{ border: `1px solid ${C.cyan}`, background: `${C.cyan}1a`, color: C.cyan, borderRadius: 2, padding: "6px 12px", fontSize: 11, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.6 : 1, display: "inline-flex", alignItems: "center", gap: 6 }}
                  >
                    <Play size={12} /> {loading ? "Running..." : "Run"}
                  </button>
                </div>
              </div>
            </PanelBox>

            {response && (
              <div ref={responseRef}>
              <PanelBox>
                <SectionHead icon="📦" title="Response" right={<Badge label={`${response.status}`} color={response.ok ? C.ok : C.err} small />} />
                <div style={{ padding: 12, display: "grid", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <Badge label={`${response.method}`} color={METHOD_COLOR[response.method] || C.muted} small />
                    <span style={{ color: C.head, fontFamily: "'Courier New',monospace", fontSize: 10 }}>{response.url}</span>
                    <span style={{ marginLeft: "auto", color: C.muted, fontSize: 10, fontFamily: "'Courier New',monospace" }}>
                      {response.elapsed} ms · {response.bytes} B
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "inline-flex", border: `1px solid ${C.border}`, borderRadius: 2, overflow: "hidden" }}>
                      <button onClick={() => setPretty(true)} style={{ border: "none", background: pretty ? `${C.cyan}22` : "transparent", color: pretty ? C.cyan : C.muted, padding: "4px 8px", fontSize: 9, cursor: "pointer" }}>Pretty</button>
                      <button onClick={() => setPretty(false)} style={{ border: "none", background: !pretty ? `${C.cyan}22` : "transparent", color: !pretty ? C.cyan : C.muted, padding: "4px 8px", fontSize: 9, cursor: "pointer" }}>Raw</button>
                    </div>
                    <button
                      onClick={() => copyText(typeof response.data === "string" ? response.data : JSON.stringify(response.data, null, 2), "Response copied")}
                      style={{ border: `1px solid ${C.border}`, background: "transparent", color: C.muted, borderRadius: 2, padding: "4px 8px", fontSize: 9, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}
                    >
                      <Copy size={12} /> Copy response
                    </button>
                  </div>
                  <pre style={{ margin: 0, border: `1px solid ${C.border}`, background: C.dim, borderRadius: 2, color: C.text, padding: "10px 12px", maxHeight: 380, overflow: "auto", whiteSpace: "pre-wrap", fontFamily: "'Courier New',monospace", fontSize: 11 }}>
                    {pretty
                      ? (typeof response.data === "string" ? response.data : JSON.stringify(response.data, null, 2))
                      : (typeof response.data === "string" ? response.data : JSON.stringify(response.data))}
                  </pre>
                </div>
              </PanelBox>
              </div>
            )}

            <PanelBox>
              <SectionHead icon="🧾" title="Recent Calls" right={<Badge label={`${history.length}`} color={C.info} small />} />
              <div style={{ padding: "6px 10px 10px", display: "grid", gap: 4 }}>
                {history.length === 0 ? (
                  <div style={{ color: C.muted, fontSize: 10 }}>No calls yet.</div>
                ) : history.map((h, idx) => (
                  <div key={`${h.at}-${idx}`} style={{ display: "grid", gridTemplateColumns: "56px 1fr 42px 56px", gap: 8, borderBottom: `1px solid ${C.border}`, padding: "4px 0", alignItems: "center" }}>
                    <span style={{ color: METHOD_COLOR[h.method] || C.muted, fontSize: 9, fontWeight: 700 }}>{h.method}</span>
                    <span style={{ color: C.head, fontFamily: "'Courier New',monospace", fontSize: 9, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.url}</span>
                    <span style={{ color: h.ok ? C.ok : C.err, fontFamily: "'Courier New',monospace", fontSize: 9 }}>{h.status}</span>
                    <span style={{ color: C.muted, fontFamily: "'Courier New',monospace", fontSize: 9 }}>{h.elapsed}ms</span>
                  </div>
                ))}
              </div>
            </PanelBox>
          </>
        )}
      </div>
    </div>
  );
}
