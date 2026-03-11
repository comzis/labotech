'use strict';

const express    = require('express');
const WebSocket  = require('ws');
const { MulticastForwarder } = require('../src/multicast-forward');

const DEFAULT_NIC    = process.env.MULTICAST_NIC             || 'eno2';
const DEFAULT_SUBNET = process.env.FORWARD_MULTICAST_SUBNET  || '239.100.25.0/26';
const DEFAULT_IP     = process.env.FORWARD_MULTICAST_IP      || '239.100.25.29';
const MAX_FORWARDERS = parseInt(process.env.MAX_ACTIVE_FORWARDERS || '1');

module.exports = function(forwarders, wss, saveState = () => {}, broadcastFn = null) {
  const router = express.Router();

  async function stopAndWait(instance, timeoutMs = 5000) {
    await new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        instance.removeListener('stopped', onStopped);
        resolve();
      };
      const onStopped = () => done();
      const timer = setTimeout(done, timeoutMs);
      instance.once('stopped', onStopped);
      try { instance.stop(); } catch (_) { done(); }
    });
    // Safety check: do not report stop success while process is still running.
    if (instance && instance.isRunning) {
      throw new Error('Forwarder stop verification failed: process still running');
    }
  }

  function broadcast(msg) {
    if (typeof broadcastFn === 'function') return broadcastFn(msg);
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
    const { id, sourceUrl, destIp, destPort, nic, ttl, engineerApproved } = req.body;

    if (!id || !sourceUrl || !destIp) {
      return res.status(400).json({ error: 'id, sourceUrl and destIp are required' });
    }
    if (engineerApproved !== true) {
      return res.status(403).json({ error: 'Engineer approval required to start forwarding (engineerApproved=true)' });
    }
    if (destIp !== DEFAULT_IP) {
      return res.status(403).json({ error: `Forwarding allowed only to ${DEFAULT_IP}` });
    }
    if (forwarders.has(id)) {
      return res.status(409).json({ error: `Forwarder ${id} already exists` });
    }
    if (forwarders.size >= MAX_FORWARDERS) {
      return res.status(429).json({ error: `Forwarder limit reached (${MAX_FORWARDERS}). Preventing eno2 flooding.` });
    }

    const targetPort = parseInt(destPort || 1234);
    const targetNic = nic || DEFAULT_NIC;
    const duplicate = [...forwarders.values()].some(f =>
      f.destIp === destIp && parseInt(f.destPort) === targetPort && f.nic === targetNic
    );
    if (duplicate) {
      return res.status(409).json({ error: `Forwarding to ${destIp}:${targetPort} on ${targetNic} already exists` });
    }

    try {
      const fwd = new MulticastForwarder({ id, sourceUrl, destIp, destPort, nic, ttl, allowedIp: DEFAULT_IP });
      fwd.on('stats',   stats => broadcast({ type: 'multicast_stats', id, ...stats }));
      fwd.on('info',    msg   => broadcast({ type: 'info', id, message: msg.message, inputBitrate: msg.inputBitrate, inputBitrateWatchAttempts: msg.inputBitrateWatchAttempts }));
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
  router.delete('/forward/:id', async (req, res) => {
    const fwd = forwarders.get(req.params.id);
    if (!fwd) return res.status(404).json({ error: 'Forwarder not found' });
    await stopAndWait(fwd);
    forwarders.delete(req.params.id);
    saveState();
    res.json({ stopped: req.params.id });
  });

  return router;
};
