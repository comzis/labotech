'use strict';

const express = require('express');

const ENCAPSULATOR_API_URL = process.env.ENCAPSULATOR_API_URL || 'http://127.0.0.1:4100';

module.exports = function () {
  const router = express.Router();

  async function forward(req, res, targetPath) {
    const url = `${ENCAPSULATOR_API_URL}${targetPath}`;
    const method = req.method;
    const body = method === 'GET' || method === 'DELETE' ? undefined : JSON.stringify(req.body || {});

    try {
      const upstream = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body,
      });
      const contentType = upstream.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const payload = await upstream.json();
        return res.status(upstream.status).json(payload);
      }
      const text = await upstream.text();
      return res.status(upstream.status).send(text);
    } catch (err) {
      return res.status(503).json({
        error: `Encapsulator service unavailable: ${err.message}`,
        target: ENCAPSULATOR_API_URL,
      });
    }
  }

  router.get('/health', (req, res) => forward(req, res, '/health'));
  router.get('/channels', (req, res) => forward(req, res, '/channels'));
  router.get('/channels/:id', (req, res) => forward(req, res, `/channels/${encodeURIComponent(req.params.id)}`));
  router.post('/channels', (req, res) => forward(req, res, '/channels'));
  router.delete('/channels/:id', (req, res) => forward(req, res, `/channels/${encodeURIComponent(req.params.id)}`));

  return router;
};
