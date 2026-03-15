const BASE = '';

async function requestDetailed(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  const contentType = res.headers.get('content-type') || '';
  let data = null;
  if (contentType.includes('application/json')) {
    try {
      data = await res.json();
    } catch (_) {
      data = { error: `Invalid or empty JSON response (HTTP ${res.status})` };
    }
  } else {
    const text = await res.text();
    data = text ? { error: text } : {};
  }
  return {
    ok: res.ok,
    status: res.status,
    data,
  };
}

async function request(method, path, body) {
  const result = await requestDetailed(method, path, body);
  if (!result.ok) throw new Error(result.data.error || `HTTP ${result.status}`);
  return result.data;
}

// Streams
export const getStreams = () => request('GET', '/encap/channels');
export const startStream = (body) => request('POST', '/encap/channels', body);
export const getStream = (id) => request('GET', `/encap/channels/${id}`);
export const stopStream = (id) => request('DELETE', `/encap/channels/${id}`);
export const getEncapsulatorHealth = () => request('GET', '/encap/health');
export const inspectEncapPortOffender = (port = 4100) => request('GET', `/encap/port-offender?port=${encodeURIComponent(port)}`);
export const resolveEncapPortOffender = (port = 4100, confirm = false) =>
  request('POST', '/encap/port-offender/resolve', { port, confirm });

// Transcode
export const getTranscoders = () => request('GET', '/transcode');
export const getPresets = () => request('GET', '/transcode/presets');
export const getBroadcastPresets = () => request('GET', '/transcode/broadcast-presets');
export const startTranscoder = (body) => request('POST', '/transcode', body);
export const stopTranscoder = (id) => request('DELETE', `/transcode/${id}`);

// Multicast
export const getMulticastConfig = () => request('GET', '/multicast/config');
export const getForwarders = () => request('GET', '/multicast/forward');
export const startForwarder = (body) => request('POST', '/multicast/forward', body);
export const stopForwarder = (id) => request('DELETE', `/multicast/forward/${id}`);

// Analyse
export const probeUrl = (url) => request('GET', `/analyse?url=${encodeURIComponent(url)}`);
export const getAnalysers = () => request('GET', '/analyse');
export const startAnalyser = (body) => request('POST', '/analyse/start', body);
export const getAnalyser = (id) => request('GET', `/analyse/${id}`);
export const stopAnalyser = (id) => request('DELETE', `/analyse/${id}`);

// ETR 290
export const getETR290Monitors = () => request('GET', '/etr290');
export const startETR290 = (body) => request('POST', '/etr290/start', body);
export const getETR290 = (id) => request('GET', `/etr290/${id}`);
export const stopETR290 = (id) => request('DELETE', `/etr290/${id}`);
export const updateETR290Config = (id, body) => request('PUT', `/etr290/${id}/config`, body);
export const getETR290Profiles = () => request('GET', '/etr290/profiles');
export const saveETR290Profile = (body) => request('POST', '/etr290/profiles', body);
export const deleteETR290Profile = (name) => request('DELETE', `/etr290/profiles/${encodeURIComponent(name)}`);

// Health
export const getHealth = () => request('GET', '/health');

// Generic (for API Explorer / tools)
export const apiRequestDetailed = (method, path, body) => requestDetailed(method, path, body);

// Event Log
// Pass since= so the server ring (14-day retention) doesn't rehydrate
// events older than the timeline's own 26h window.
const EVENT_LOG_RETENTION_MS = 26 * 60 * 60 * 1000;
export const getEvents = () => {
  const since = Date.now() - EVENT_LOG_RETENTION_MS;
  return request('GET', `/api/events?since=${since}`);
};
export const clearEvents = () => request('DELETE', '/api/events');

export const getMonitoringPolicy = () => request('GET', '/monitoring-policy');
export const setMonitoringProfile = (profile) => request('PUT', '/monitoring-policy/profile', { profile });
