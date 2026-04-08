'use strict';

const fs         = require('fs');
const path       = require('path');
const express    = require('express');
const WebSocket  = require('ws');
const TSAnalyser = require('../src/ts-analyser');
const { THUMBNAIL_DIR, sanitizeStreamId } = require('../src/monitoring');


module.exports = function(analysers, wss, broadcastFn = null, saveState = null, thumbnailClient = null, etr290monitors = null) {
  const router = express.Router();

  function broadcast(msg) {
    if (typeof broadcastFn === 'function') return broadcastFn(msg);
    const data = JSON.stringify(msg);
    wss.clients.forEach(c => {
      if (c.readyState === WebSocket.OPEN) c.send(data);
    });
  }

  // Auto-start an ETR290 monitor linked to a decoder.
  // Called after analyser.startContinuous() so the SRT relay is already
  // instantiated and getRelayUrl() returns a non-null URL synchronously.
  function _autoStartEtr(id, analyser, url) {
    if (!etr290monitors) return;
    const etrId = `etr-${id}`;
    if (etr290monitors.has(etrId)) return; // already running (e.g. restored from state)
    try {
      const ETR290Analyser = require('../src/etr290-analyser');
      const etrUrl = url.startsWith('srt://')
        ? (analyser.getRelayUrl() || url)
        : url;
      const mon = new ETR290Analyser({ id: etrId, url: etrUrl });
      mon.on('etr290',            status   => broadcast({ type: 'etr290_status',           id: etrId, ...status   }));
      mon.on('alarm',             alarm    => broadcast({ type: 'etr290_alarm',             id: etrId, ...alarm    }));
      mon.on('incident_started',  incident => broadcast({ type: 'etr290_incident_started',  id: etrId, ...incident }));
      mon.on('incident_updated',  incident => broadcast({ type: 'etr290_incident_updated',  id: etrId, ...incident }));
      mon.on('incident_cleared',  incident => broadcast({ type: 'etr290_incident_cleared',  id: etrId, ...incident }));
      mon.on('error',             err      => broadcast({ type: 'error',                    id: etrId, message: err.message }));
      mon.on('stopped',           ()       => broadcast({ type: 'etr290_stopped',           id: etrId }));
      if (typeof analyser.setEtrMonitor === 'function') analyser.setEtrMonitor(mon);
      const startDelay = typeof analyser.getEtrStartDelay === 'function' ? analyser.getEtrStartDelay() : 0;
      mon.start(startDelay);
      etr290monitors.set(etrId, mon);
      broadcast({ type: 'etr290_started', id: etrId, url: etrUrl, time: new Date().toISOString() });
    } catch (err) {
      console.error(`[analyse] Failed to auto-start ETR monitor for ${id}:`, err.message);
    }
  }

  // Stop the linked ETR monitor when a decoder is removed.
  function _autoStopEtr(id, analyser) {
    if (!etr290monitors) return;
    const etrId = `etr-${id}`;
    const mon = etr290monitors.get(etrId);
    if (mon) {
      mon.stop();
      etr290monitors.delete(etrId);
    }
    if (analyser && typeof analyser.clearEtrMonitor === 'function') analyser.clearEtrMonitor();
  }

  // GET /analyse?url=...  (one-shot probe)
  router.get('/', async (req, res) => {
    const { url } = req.query;
    // If no url is provided, return active analysers list
    if (!url) {
      return res.json([...analysers.values()].map(a => a.toJSON()));
    }

    const analyser = new TSAnalyser({ url });
    try {
      const result = await analyser.probe();
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /analyse/start  (continuous)
  router.post('/start', (req, res) => {
    const { id, url, interval, nicName } = req.body;
    if (!id || !url) return res.status(400).json({ error: 'id and url are required' });
    if (analysers.has(id)) return res.status(409).json({ error: `Analyser ${id} already exists` });

    const analyser = new TSAnalyser({ id, url, interval, nicName: nicName || undefined, thumbnailClient: thumbnailClient || undefined });

    analyser.on('result', result => broadcast({ type: 'analyse_result', id, ...result }));
    analyser.on('health_alarm', data => broadcast({ type: 'health_alarm', id, ...data }));
    analyser.on('error',  err    => broadcast({ type: 'error', id, message: err.message }));

    analyser.startContinuous();
    analysers.set(id, analyser);

    // Auto-start ETR290 monitor — relay is synchronously instantiated by startContinuous()
    // for SRT streams so getRelayUrl() is available immediately.
    _autoStartEtr(id, analyser, url);

    if (saveState) saveState();
    broadcast({ type: 'analyse_started', id, message: `${id} analyser started` });
    res.status(201).json(analyser.toJSON());
  });

  // GET /analyse/:id
  router.get('/:id', (req, res) => {
    const a = analysers.get(req.params.id);
    if (!a) return res.status(404).json({ error: 'Analyser not found' });
    res.json(a.toJSON());
  });

  // DELETE /analyse/:id
  router.delete('/:id', (req, res) => {
    const id = req.params.id;
    const a = analysers.get(id);
    if (!a) return res.status(404).json({ error: 'Analyser not found' });

    // Stop linked ETR monitor before stopping the analyser — avoids the orphan
    // watchdog race and ensures clean state snapshot in saveState().
    _autoStopEtr(id, a);

    a.stop();
    analysers.delete(id);
    // Remove stale thumbnail so a ghost JPEG cannot persist across restarts
    // and confuse operators or conflict with a new decoder using the same slot.
    try {
      const thumbPath = path.join(THUMBNAIL_DIR, `${sanitizeStreamId(id)}.jpg`);
      if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
    } catch (_) {}
    if (saveState) saveState();
    broadcast({ type: 'analyse_stopped', id, message: `${id} analyser stopped` });
    res.json({ stopped: id });
  });

  return router;
};
