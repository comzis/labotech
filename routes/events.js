'use strict';

const express = require('express');

const EVENTS_LIMIT_DEFAULT = 500;
const EVENTS_LIMIT_MAX     = 2000;

module.exports = function(eventLog) {
  const router = express.Router();

  // GET /events[?since=<ms>][&id=<streamId>][&type=<eventType>][&limit=<n>]
  // All filters are cumulative (AND logic). limit caps result count (default 500, max 2000).
  router.get('/', (req, res) => {
    const { since, id, type, limit } = req.query;
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

    const limitN = limit
      ? Math.min(Math.max(1, parseInt(limit, 10) || EVENTS_LIMIT_DEFAULT), EVENTS_LIMIT_MAX)
      : EVENTS_LIMIT_DEFAULT;
    if (events.length > limitN) events = events.slice(0, limitN);

    res.json(events);
  });

  router.delete('/', (req, res) => {
    eventLog.clear();
    res.json({ cleared: true });
  });

  return router;
};
