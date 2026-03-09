'use strict';

// require('dotenv').config();

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const API_HOST = process.env.API_HOST || '10.67.18.29';
const API_PORT = parseInt(process.env.API_PORT) || 3000;

// Shared state maps
const streams = new Map();  // id → SRTEncoder
const transcoders = new Map(); // id → Transcoder
const forwarders = new Map(); // id → MulticastForwarder
const analysers = new Map(); // id → TSAnalyser

function createApp(wss) {
  const app = express();
  app.use(express.json());

  // Serve built frontend
  const webDist = path.join(__dirname, '..', 'web', 'dist');
  app.use(express.static(webDist));

  // Mount routes
  app.use('/streams', require('../routes/streams')(streams, wss));
  app.use('/transcode', require('../routes/transcode')(transcoders, wss));
  app.use('/multicast', require('../routes/multicast')(forwarders, wss));
  app.use('/analyse', require('../routes/analyse')(analysers, wss));
  app.use('/pipeline', require('../routes/pipelines')(streams, transcoders, forwarders, wss));
  app.use('/scte35', require('../routes/scte35')());

  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      streams: streams.size + transcoders.size,
    });
  });

  // Fallback → SPA
  app.get('*', (req, res) => {
    res.sendFile(path.join(webDist, 'index.html'));
  });

  return app;
}

function broadcastStats(wss, type, id, stats) {
  const msg = JSON.stringify({ type, id, ...stats });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

function start() {
  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocket.Server({ server });

  // Rebuild app with wss injected
  app.use(express.json());

  const webDist = path.join(__dirname, '..', 'web', 'dist');
  app.use(express.static(webDist));

  app.use('/streams', require('../routes/streams')(streams, wss));
  app.use('/transcode', require('../routes/transcode')(transcoders, wss));
  app.use('/multicast', require('../routes/multicast')(forwarders, wss));
  app.use('/analyse', require('../routes/analyse')(analysers, wss));
  app.use('/pipeline', require('../routes/pipelines')(streams, transcoders, forwarders, wss));
  app.use('/scte35', require('../routes/scte35')());

  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      streams: streams.size + transcoders.size,
    });
  });

  app.get('*', (req, res) => {
    const indexPath = path.join(webDist, 'index.html');
    const fs = require('fs');
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.status(200).json({ status: 'Labotech API running' });
    }
  });

  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'connected', uptime: process.uptime() }));
  });

  server.listen(API_PORT, API_HOST, () => {
    console.log(`Labotech API listening on http://${API_HOST}:${API_PORT}`);
  });

  return { server, wss, streams, transcoders, forwarders, analysers };
}

module.exports = { start, broadcastStats, streams, transcoders, forwarders, analysers };
