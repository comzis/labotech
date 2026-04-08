'use strict';

const express = require('express');

module.exports = function(eventLog) {
  const router = express.Router();

  // GET /events[?since=<ms>][&id=<streamId>][&type=<eventType>]
  // All filters are cumulative (AND logic).
  router.get('/', (req, res) => {
    const { since, id, type } = req.query;
    let events = eventLog.list();

    if (since) {
      const sinceMs = Number(since);
      if (Number.isFinite(sinceMs) && sinceMs > 0) {
        events = events.filter((e) => {
          const t = e.time ? new Date(e.time).getTime() : 0;
          return t >= sinceMs;
        });
      }
    }
    if (id)   events = events.filter((e) => e.id   === id);
    if (type) events = events.filter((e) => e.type === type);

    res.json(events);
  });

  router.delete('/', (req, res) => {
    eventLog.clear();
    res.json({ cleared: true });
  });

  return router;
};
