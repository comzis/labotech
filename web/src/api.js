const BASE = '';

async function request(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// Streams
export const getStreams = () => request('GET', '/streams');
export const startStream = (body) => request('POST', '/streams', body);
export const getStream = (id) => request('GET', `/streams/${id}`);
export const stopStream = (id) => request('DELETE', `/streams/${id}`);

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
export const startAnalyser = (body) => request('POST', '/analyse/start', body);
export const getAnalyser = (id) => request('GET', `/analyse/${id}`);
export const stopAnalyser = (id) => request('DELETE', `/analyse/${id}`);

// ETR 290
export const getETR290Monitors = () => request('GET', '/etr290');
export const startETR290 = (body) => request('POST', '/etr290/start', body);
export const getETR290 = (id) => request('GET', `/etr290/${id}`);
export const stopETR290 = (id) => request('DELETE', `/etr290/${id}`);

// Health
export const getHealth = () => request('GET', '/health');
