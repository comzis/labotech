'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const TSAnalyser = require('../src/ts-analyser');

const CONFIG_FILE   = path.join(__dirname, '..', 'config', 'multiview-panels.json');
const CATALOG_FILE  = path.join(__dirname, '..', 'config', 'multiview-stream-catalog.json');

const EXPORT_VERSION = 1;

function safePanels(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((p, i) => ({
    id: String(p.id || `panel-${i + 1}`),
    name: String(p.name || '').slice(0, 32),
    streams: Array.isArray(p.streams) ? p.streams.map((s) => ({
      id: String(s.id || '').slice(0, 64),
      name: String(s.name || '').slice(0, 64),
      ip: String(s.ip || '').slice(0, 64),
      port: String(s.port || '').slice(0, 8),
      mode: ['rtp', 'udp', 'srt'].includes(String(s.mode)) ? String(s.mode) : 'rtp',
    })) : [],
  }));
}

function readPanels() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return [];
    const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    return safePanels(data.panels);
  } catch (_) {
    return [];
  }
}

// Parse an analyser probe URL into human-readable fields for the export bundle.
function parseDecoderUrl(url) {
  if (!url) return {};
  try {
    if (url.startsWith('udp://')) {
      const u = new URL(url);
      return { protocol: 'udp', host: u.hostname, port: u.port };
    }
    if (url.startsWith('rtp://')) {
      const u = new URL(url);
      return { protocol: 'rtp', host: u.hostname, port: u.port };
    }
    if (url.startsWith('srt://')) {
      const u = new URL(url);
      return {
        protocol: 'srt',
        host: u.hostname,
        port: u.port,
        latency: u.searchParams.get('latency') || null,
        passphrase: u.searchParams.get('passphrase') || null,
        pbkeylen: u.searchParams.get('pbkeylen') || null,
      };
    }
  } catch (_) {}
  return { protocol: 'unknown' };
}

module.exports = function (analysers, saveState, broadcast) {
  const router = express.Router();

  // GET /api/multiview/catalog — stream catalog for the decoder host/IP picker
  router.get('/catalog', (req, res) => {
    try {
      if (!fs.existsSync(CATALOG_FILE)) return res.json({ streams: [] });
      const data = JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8'));
      return res.json({ streams: Array.isArray(data.streams) ? data.streams : [] });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // POST /api/multiview/catalog — upload a stream catalog (JSON or CSV)
  // JSON: bare array [...] or wrapped { "streams": [...] }
  // CSV:  name,ip,port,mode  (header row required)
  router.post('/catalog', (req, res) => {
    try {
      const { format, data } = req.body;
      if (!data) return res.status(400).json({ error: 'No data provided' });

      let streams;

      if (format === 'csv') {
        const lines = data.split('\n').map((l) => l.trim()).filter(Boolean);
        if (lines.length < 2) return res.status(400).json({ error: 'CSV must have a header row and at least one data row' });
        const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
        const nameIdx = headers.indexOf('name');
        const ipIdx   = headers.indexOf('ip');
        const portIdx = headers.indexOf('port');
        const modeIdx = headers.indexOf('mode');
        if (nameIdx === -1 || ipIdx === -1 || portIdx === -1) {
          return res.status(400).json({ error: 'CSV must have columns: name, ip, port (mode optional)' });
        }
        streams = lines.slice(1).map((line) => {
          const cols = line.split(',').map((v) => v.trim());
          return {
            name: cols[nameIdx] || '',
            ip:   cols[ipIdx]   || '',
            port: cols[portIdx] || '',
            mode: modeIdx !== -1 && cols[modeIdx] ? cols[modeIdx] : 'rtp',
          };
        });
      } else {
        // JSON — accept bare array or { streams: [...] }
        const parsed = typeof data === 'string' ? JSON.parse(data) : data;
        streams = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.streams) ? parsed.streams : null);
        if (!streams) return res.status(400).json({ error: 'JSON must be an array or { "streams": [...] }' });
      }

      // Validate: require name, ip, port; normalise mode
      const valid = streams.filter((s) => s && s.name && s.ip && s.port).map((s) => ({
        name: String(s.name).slice(0, 128),
        ip:   String(s.ip).slice(0, 64),
        port: String(s.port).slice(0, 8),
        mode: ['rtp', 'udp', 'srt'].includes(String(s.mode)) ? String(s.mode) : 'rtp',
      }));

      if (valid.length === 0) return res.status(400).json({ error: 'No valid stream entries found (each entry needs name, ip, port)' });

      fs.writeFileSync(CATALOG_FILE, JSON.stringify({ streams: valid }, null, 2), 'utf8');
      return res.json({ ok: true, count: valid.length });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  });

  // GET /api/multiview/panels — return stored panel stream registry
  router.get('/panels', (req, res) => {
    try {
      return res.json({ panels: readPanels() });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/multiview/panels — persist panel stream registry
  router.put('/panels', (req, res) => {
    try {
      const { panels } = req.body || {};
      if (!Array.isArray(panels)) {
        return res.status(400).json({ error: 'panels must be an array' });
      }
      const safe = safePanels(panels);
      fs.writeFileSync(CONFIG_FILE, JSON.stringify({ panels: safe }, null, 2), 'utf8');
      return res.json({ ok: true, panels: safe });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // GET /api/multiview/export — full config bundle for workstation migration
  // Returns running decoders (with parsed connection fields) + panel registry.
  // The frontend merges this with the client-side panel→decoder assignment
  // (decoderIds per panel) before triggering the browser download.
  router.get('/export', (req, res) => {
    try {
      const panels = readPanels();
      const decoders = analysers
        ? [...analysers.values()]
          .filter((a) => a.isRunning)
          .map((a) => ({
            id: a.id,
            url: a.url,
            interval: a.interval,
            nicName: a.nicName || null,
            parsed: parseDecoderUrl(a.url),
          }))
        : [];
      return res.json({
        exportVersion: EXPORT_VERSION,
        exportedAt: new Date().toISOString(),
        application: 'LaboTech',
        panels,
        decoders,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // POST /api/multiview/import — restore a config bundle on this workstation.
  // Writes panels to multiview-panels.json and starts all decoders.
  // The frontend supplies the full export JSON (including client-side decoderIds).
  router.post('/import', (req, res) => {
    const { exportVersion, panels, decoders } = req.body || {};
    if (exportVersion !== EXPORT_VERSION) {
      return res.status(400).json({ error: `Unsupported exportVersion: ${exportVersion}` });
    }

    const errors = [];

    // Restore panel registry (streams catalog per panel)
    if (Array.isArray(panels)) {
      try {
        const safe = safePanels(panels);
        fs.writeFileSync(CONFIG_FILE, JSON.stringify({ panels: safe }, null, 2), 'utf8');
      } catch (err) {
        errors.push(`Panel save failed: ${err.message}`);
      }
    }

    // Start decoders
    const started = [];
    if (Array.isArray(decoders) && analysers) {
      for (const d of decoders) {
        if (!d.id || !d.url) { errors.push(`Skipped: missing id/url`); continue; }
        if (analysers.has(d.id)) { errors.push(`Skipped: ${d.id} already running`); continue; }
        try {
          const a = new TSAnalyser({
            id: d.id,
            url: d.url,
            interval: d.interval || 5000,
            nicName: d.nicName || undefined,
          });
          if (typeof broadcast === 'function') {
            a.on('result',       (result) => broadcast({ type: 'analyse_result', id: d.id, ...result }));
            a.on('health_alarm', (data)   => broadcast({ type: 'health_alarm',   id: d.id, ...data }));
            a.on('error',        (err)    => broadcast({ type: 'error',           id: d.id, message: err.message }));
          }
          a.startContinuous();
          analysers.set(d.id, a);
          started.push(d.id);
        } catch (err) {
          errors.push(`Failed to start ${d.id}: ${err.message}`);
        }
      }
      if (started.length > 0 && typeof saveState === 'function') saveState();
    }

    return res.json({ ok: true, started, errors });
  });

  return router;
};
