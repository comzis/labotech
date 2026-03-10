'use strict';

const express    = require('express');
const WebSocket  = require('ws');
const { MulticastForwarder } = require('../src/multicast-forward');

const DEFAULT_NIC    = process.env.MULTICAST_NIC             || 'eno2';
const DEFAULT_SUBNET = process.env.FORWARD_MULTICAST_SUBNET  || '239.100.25.0/26';
const DEFAULT_IP     = process.env.FORWARD_MULTICAST_IP      || '239.100.25.29';

module.exports = function(forwarders, wss, saveState = () => {}) {
  const router = express.Router();

  function broadcast(msg) {
    const data = JSON.stringify(msg);
    wss.clients.forEach(c => {
      if (c.readyState === WebSocket.OPEN) c.send(data);
    });
  }

  // GET /multicast/config
  router.get('/config', (req, res) => {
    res.json({
      nic:     DEFAULT_NIC,
      subnet:  DEFAULT_SUBNET,
      address: DEFAULT_IP,
      ttl:     parseInt(process.env.MULTICAST_TTL) || 10,
    });
  });

  // GET /multicast/forward
  router.get('/forward', (req, res) => {
    res.json([...forwarders.values()].map(f => f.toJSON()));
  });

  // POST /multicast/forward
  router.post('/forward', async (req, res) => {
    const { id, sourceUrl, destIp, destPort, nic, ttl } = req.body;

    if (!id || !sourceUrl || !destIp) {
      return res.status(400).json({ error: 'id, sourceUrl and destIp are required' });
    }
    if (forwarders.has(id)) {
      return res.status(409).json({ error: `Forwarder ${id} already exists` });
    }

    try {
      const fwd = new MulticastForwarder({ id, sourceUrl, destIp, destPort, nic, ttl });
      fwd.on('stats',   stats => broadcast({ type: 'multicast_stats', id, ...stats }));
      fwd.on('error',   err   => broadcast({ type: 'error', id, message: err.message }));
      fwd.on('stopped',       () => broadcast({ type: 'multicast_stopped', id }));
      await fwd.start();
      forwarders.set(id, fwd);
      saveState();
      res.status(201).json(fwd.toJSON());
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // GET /multicast/forward/:id
  router.get('/forward/:id', (req, res) => {
    const fwd = forwarders.get(req.params.id);
    if (!fwd) return res.status(404).json({ error: 'Forwarder not found' });
    res.json(fwd.toJSON());
  });

  // DELETE /multicast/forward/:id
  router.delete('/forward/:id', (req, res) => {
    const fwd = forwarders.get(req.params.id);
    if (!fwd) return res.status(404).json({ error: 'Forwarder not found' });
    fwd.stop();
    forwarders.delete(req.params.id);
    saveState();
    res.json({ stopped: req.params.id });
  });

  return router;
};
