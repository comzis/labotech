'use strict';

const express    = require('express');
const WebSocket  = require('ws');
const TSAnalyser = require('../src/ts-analyser');

module.exports = function(analysers, wss) {
  const router = express.Router();

  function broadcast(msg) {
    const data = JSON.stringify(msg);
    wss.clients.forEach(c => {
      if (c.readyState === WebSocket.OPEN) c.send(data);
    });
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

    const analyser = new TSAnalyser({ id, url, interval, nicName: nicName || undefined });

    analyser.on('result', result => broadcast({ type: 'analyse_result', id, ...result }));
    analyser.on('error',  err    => broadcast({ type: 'error', id, message: err.message }));

    analyser.startContinuous();
    analysers.set(id, analyser);
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
    const a = analysers.get(req.params.id);
    if (!a) return res.status(404).json({ error: 'Analyser not found' });
    a.stop();
    analysers.delete(req.params.id);
    res.json({ stopped: req.params.id });
  });

  return router;
};
