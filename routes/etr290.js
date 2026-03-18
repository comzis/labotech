'use strict';

const express = require('express');
const WebSocket = require('ws');
const ETR290Analyser = require('../src/etr290-analyser');
const ETR290ProfileStore = require('../src/etr290-profile-store');

module.exports = function (etr290monitors, wss, broadcastFn = null, analysers = null) {
  const router = express.Router();
  const profileStore = new ETR290ProfileStore();

  function broadcast(msg) {
    if (typeof broadcastFn === 'function') return broadcastFn(msg);
    const data = JSON.stringify(msg);
    wss.clients.forEach(c => {
      if (c.readyState === WebSocket.OPEN) c.send(data);
    });
  }

  // GET /etr290
  router.get('/', (req, res) => {
    res.json([...etr290monitors.values()].map(m => m.toJSON()));
  });

  // GET /etr290/profiles
  router.get('/profiles', (req, res) => {
    res.json(profileStore.list());
  });

  // POST /etr290/profiles
  router.post('/profiles', (req, res) => {
    try {
      const saved = profileStore.save({
        name: req.body?.name,
        description: req.body?.description,
        config: req.body?.config || {},
      });
      res.status(201).json(saved);
    } catch (err) {
      res.status(400).json({ error: err.message || 'Failed to save profile' });
    }
  });

  // DELETE /etr290/profiles/:name
  router.delete('/profiles/:name', (req, res) => {
    const ok = profileStore.remove(req.params.name);
    if (!ok) return res.status(404).json({ error: 'Profile not found' });
    res.json({ deleted: req.params.name });
  });

  // POST /etr290/start
  router.post('/start', (req, res) => {
    const { id, url, nicName, profileName } = req.body;
    if (!id || !url) return res.status(400).json({ error: 'id and url are required' });
    if (etr290monitors.has(id)) return res.status(409).json({ error: `ETR290 monitor ${id} already exists` });

    // SRT single-listener guard: ETR cannot connect directly to an SRT source
    // that already has a relay or thumbnail holding the caller slot.
    // When a TSAnalyser relay is active for this stream, ETR uses the relay's
    // local UDP copy instead — unlimited readers, no slot contention.
    let effectiveUrl = url;
    if (url.startsWith('srt://')) {
      const linkedId = /^etr-/i.test(id) ? id.slice(4) : null;
      const linkedAnalyser = linkedId && analysers ? analysers.get(linkedId) : null;
      const relayUrl = linkedAnalyser && typeof linkedAnalyser.getRelayUrl === 'function'
        ? linkedAnalyser.getRelayUrl()
        : null;
      if (relayUrl) {
        // Relay is active — redirect ETR to the local UDP copy.
        effectiveUrl = relayUrl;
      } else {
        // No relay present — direct SRT ETR is not supported.
        return res.status(422).json({
          error: 'ETR290 monitoring is not available on single-listener SRT sources. ' +
            'Start the decoder first (the SRT relay will be created automatically), ' +
            'then enable ETR. The relay provides a shared UDP copy for unlimited consumers.',
        });
      }
    }

    let profileConfig = {};
    if (profileName) {
      const profile = profileStore.get(profileName);
      if (!profile) return res.status(404).json({ error: `Profile ${profileName} not found` });
      profileConfig = profile.config || {};
    }

    const mergedConfig = {
      ...(profileConfig || {}),
      ...(req.body?.config || {}),
    };

    const mon = new ETR290Analyser({
      id,
      url: effectiveUrl,
      nicName: nicName || undefined,
      config: mergedConfig,
      profileName: profileName || mergedConfig.profileName || null,
    });

    mon.on('etr290', status => broadcast({ type: 'etr290_status', id, ...status }));
    mon.on('alarm',  alarm  => broadcast({ type: 'etr290_alarm',  id, ...alarm  }));
    mon.on('incident_started', incident => broadcast({ type: 'etr290_incident_started', id, ...incident }));
    mon.on('incident_updated', incident => broadcast({ type: 'etr290_incident_updated', id, ...incident }));
    mon.on('incident_cleared', incident => broadcast({ type: 'etr290_incident_cleared', id, ...incident }));
    mon.on('error',  err    => broadcast({ type: 'error', id, message: err.message }));
    mon.on('stopped', ()    => broadcast({ type: 'etr290_stopped', id }));

    // Link to TSAnalyser BEFORE starting so the start delay can be computed.
    // On SRT streams the analyser's thumbnail already holds the caller slot —
    // ETR must wait (latency + 15 s) before its first ffmpeg spawn to avoid
    // being immediately rejected by the single-listener SRT source.
    let startDelay = 0;
    if (analysers && /^etr-/i.test(id)) {
      const linkedId = id.slice(4);
      const linkedAnalyser = analysers.get(linkedId);
      if (linkedAnalyser && typeof linkedAnalyser.setEtrMonitor === 'function') {
        linkedAnalyser.setEtrMonitor(mon);
        if (typeof linkedAnalyser.getEtrStartDelay === 'function') {
          startDelay = linkedAnalyser.getEtrStartDelay();
        }
      }
    }

    mon.start(startDelay);
    etr290monitors.set(id, mon);
    res.status(201).json(mon.toJSON());
  });

  // PUT /etr290/:id/config
  router.put('/:id/config', (req, res) => {
    const mon = etr290monitors.get(req.params.id);
    if (!mon) return res.status(404).json({ error: 'Monitor not found' });
    try {
      const profileName = req.body?.profileName || null;
      let profileConfig = {};
      if (profileName) {
        const profile = profileStore.get(profileName);
        if (!profile) return res.status(404).json({ error: `Profile ${profileName} not found` });
        profileConfig = profile.config || {};
      }
      const mergedConfig = {
        ...(profileConfig || {}),
        ...(req.body?.config || {}),
      };
      mon.setConfig(mergedConfig, { profileName });
      const payload = mon.toJSON();
      broadcast({ type: 'etr290_status', id: req.params.id, ...payload });
      res.json(payload);
    } catch (err) {
      res.status(400).json({ error: err.message || 'Invalid ETR config' });
    }
  });

  // GET /etr290/:id
  router.get('/:id', (req, res) => {
    const mon = etr290monitors.get(req.params.id);
    if (!mon) return res.status(404).json({ error: 'Monitor not found' });
    res.json(mon.toJSON());
  });

  // DELETE /etr290/:id
  router.delete('/:id', (req, res) => {
    const id = req.params.id;
    const mon = etr290monitors.get(id);
    if (!mon) return res.status(404).json({ error: 'Monitor not found' });
    mon.stop();
    etr290monitors.delete(id);
    // Unlink from TSAnalyser if managed
    if (analysers && /^etr-/i.test(id)) {
      const linkedAnalyser = analysers.get(id.slice(4));
      if (linkedAnalyser && typeof linkedAnalyser.clearEtrMonitor === 'function') {
        linkedAnalyser.clearEtrMonitor();
      }
    }
    res.json({ stopped: id });
  });

  return router;
};
