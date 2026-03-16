'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, '..', 'config', 'multiview-panels.json');

const STREAM_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

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

module.exports = function () {
  const router = express.Router();

  // GET /api/multiview/panels — return stored panel stream registry
  router.get('/panels', (req, res) => {
    try {
      if (!fs.existsSync(CONFIG_FILE)) return res.json({ panels: [] });
      const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      return res.json({ panels: safePanels(data.panels) });
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

  return router;
};
