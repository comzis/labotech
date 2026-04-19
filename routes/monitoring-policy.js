'use strict';

const express = require('express');
const { getMonitoringPolicy, setProfile, PROFILES } = require('../src/monitoring-policy');

module.exports = function() {
  const router = express.Router();

  // GET /monitoring-policy — current policy + all available profiles
  router.get('/', (req, res) => {
    const current = getMonitoringPolicy();
    const profiles = Object.entries(PROFILES).map(([id, p]) => ({
      id,
      label: p.label,
      standard: p.standard,
      description: p.description,
      active: id === current.profile,
    }));
    res.json({ current, profiles });
  });

  // PUT /monitoring-policy/profile  { profile: 'srt-contribution' }
  router.put('/profile', (req, res) => {
    const { profile } = req.body || {};
    if (!profile || typeof profile !== 'string') {
      return res.status(400).json({ error: 'profile field required' });
    }
    try {
      setProfile(profile);
      const updated = getMonitoringPolicy();
      res.json({ ok: true, current: updated });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  return router;
};
