'use strict';

const express = require('express');

module.exports = function(eventLog) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const sinceRaw = req.query.since;
    const sinceMs = sinceRaw ? Number(sinceRaw) : NaN;
    const all = eventLog.list();
    if (Number.isFinite(sinceMs) && sinceMs > 0) {
      return res.json(all.filter((e) => {
        const t = e.time ? new Date(e.time).getTime() : 0;
        return t >= sinceMs;
      }));
    }
    res.json(all);
  });

  router.delete('/', (req, res) => {
    eventLog.clear();
    res.json({ cleared: true });
  });

  return router;
};
