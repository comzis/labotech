'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_PROFILES = [
  {
    name: 'default',
    description: 'Baseline ETR 290 profile (all PIDs, threshold 1)',
    config: {
      includePids: [],
      excludePids: [],
      allowUnknownPid: true,
      thresholds: {},
    },
    updatedAt: new Date(0).toISOString(),
  },
];

class ETR290ProfileStore {
  constructor(filePath) {
    this.filePath = filePath || path.join(__dirname, '..', 'config', 'etr290-profiles.json');
    this._ensureFile();
  }

  _ensureFile() {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, JSON.stringify(DEFAULT_PROFILES, null, 2));
      return;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (!Array.isArray(parsed) || parsed.length === 0) {
        fs.writeFileSync(this.filePath, JSON.stringify(DEFAULT_PROFILES, null, 2));
      }
    } catch (_) {
      fs.writeFileSync(this.filePath, JSON.stringify(DEFAULT_PROFILES, null, 2));
    }
  }

  _readAll() {
    const raw = fs.readFileSync(this.filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  }

  _writeAll(profiles) {
    fs.writeFileSync(this.filePath, JSON.stringify(profiles, null, 2));
  }

  list() {
    return this._readAll();
  }

  get(name) {
    return this._readAll().find((p) => p.name === name) || null;
  }

  save({ name, description, config }) {
    if (!name || typeof name !== 'string') {
      throw new Error('Profile name is required');
    }
    const cleanName = name.trim();
    if (!cleanName) throw new Error('Profile name is required');

    const profiles = this._readAll();
    const next = {
      name: cleanName,
      description: description ? String(description) : '',
      config: config && typeof config === 'object' ? config : {},
      updatedAt: new Date().toISOString(),
    };
    const idx = profiles.findIndex((p) => p.name === cleanName);
    if (idx >= 0) profiles[idx] = next;
    else profiles.push(next);
    this._writeAll(profiles);
    return next;
  }

  remove(name) {
    const profiles = this._readAll();
    const before = profiles.length;
    const filtered = profiles.filter((p) => p.name !== name);
    if (filtered.length === before) return false;
    this._writeAll(filtered);
    return true;
  }
}

module.exports = ETR290ProfileStore;
