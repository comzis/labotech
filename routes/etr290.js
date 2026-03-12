'use strict';

const express = require('express');
const WebSocket = require('ws');
const ETR290Analyser = require('../src/etr290-analyser');
const ETR290ProfileStore = require('../src/etr290-profile-store');

module.exports = function (etr290monitors, wss, broadcastFn = null) {
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
      url,
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

    mon.start();
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
    const mon = etr290monitors.get(req.params.id);
    if (!mon) return res.status(404).json({ error: 'Monitor not found' });
    mon.stop();
    etr290monitors.delete(req.params.id);
    res.json({ stopped: req.params.id });
  });

  return router;
};
