'use strict';

const express = require('express');

module.exports = function(eventLog) {
  const router = express.Router();

  router.get('/', (req, res) => {
    res.json(eventLog.list());
  });

  router.delete('/', (req, res) => {
    eventLog.clear();
    res.json({ cleared: true });
  });

  return router;
};
