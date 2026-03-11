'use strict';

const express = require('express');
const WebSocket = require('ws');
const ETR290Analyser = require('../src/etr290-analyser');

module.exports = function (etr290monitors, wss, broadcastFn = null) {
  const router = express.Router();

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

  // POST /etr290/start
  router.post('/start', (req, res) => {
    const { id, url, nicName } = req.body;
    if (!id || !url) return res.status(400).json({ error: 'id and url are required' });
    if (etr290monitors.has(id)) return res.status(409).json({ error: `ETR290 monitor ${id} already exists` });

    const mon = new ETR290Analyser({ id, url, nicName: nicName || undefined });

    mon.on('etr290', status => broadcast({ type: 'etr290_status', id, ...status }));
    mon.on('alarm',  alarm  => broadcast({ type: 'etr290_alarm',  id, ...alarm  }));
    mon.on('error',  err    => broadcast({ type: 'error', id, message: err.message }));
    mon.on('stopped', ()    => broadcast({ type: 'etr290_stopped', id }));

    mon.start();
    etr290monitors.set(id, mon);
    res.status(201).json(mon.toJSON());
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
