'use strict';

const express = require('express');
const { buildSpliceInsert } = require('../src/scte35');

module.exports = function() {
  const router = express.Router();

  // POST /scte35/splice
  router.post('/splice', (req, res) => {
    const {
      spliceEventId,
      outOfNetwork,
      duration,
      ptsTime,
      uniqueProgramId,
      availNum,
      availsExpected,
    } = req.body;

    const payload = buildSpliceInsert({
      spliceEventId, outOfNetwork, duration,
      ptsTime, uniqueProgramId, availNum, availsExpected,
    });

    res.json({ status: 'injected', payload });
  });

  return router;
};
