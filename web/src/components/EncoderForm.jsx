import React, { useState } from 'react';
import { startStream } from '../api';

const DEFAULTS = {
  id:           '',
  input:        '',
  host:         '',
  port:         '9999',
  latency:      '2000',
  videoBitrate: '8M',
  audioBitrate: '256k',
  videoCodec:   'libx264',
  preset:       'medium',
  passphrase:   '',
};

export default function EncoderForm({ onStarted }) {
  const [form,    setForm]    = useState(DEFAULTS);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);
  const [open,    setOpen]    = useState(false);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await startStream({
        ...form,
        port:    parseInt(form.port),
        latency: parseInt(form.latency),
      });
      setForm(DEFAULTS);
      setOpen(false);
      onStarted && onStarted();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mb-4">
      <button
        onClick={() => setOpen(o => !o)}
        className="bg-blue-700 hover:bg-blue-600 text-white text-sm px-4 py-2 rounded transition-colors"
      >
        {open ? '✕ Cancel' : '+ Start Encoder'}
      </button>

      {open && (
        <form onSubmit={handleSubmit} className="mt-4 bg-gray-900 border border-gray-800 rounded-lg p-5 grid grid-cols-2 md:grid-cols-3 gap-4">
          <Field label="Stream ID *"    value={form.id}           onChange={v => set('id', v)}           required />
          <Field label="Input URL *"    value={form.input}        onChange={v => set('input', v)}        required className="col-span-2 md:col-span-2" />
          <Field label="SRT Host *"     value={form.host}         onChange={v => set('host', v)}         required />
          <Field label="SRT Port"       value={form.port}         onChange={v => set('port', v)}         type="number" />
          <Field label="Latency (ms)"   value={form.latency}      onChange={v => set('latency', v)}      type="number" />
          <Field label="Video Bitrate"  value={form.videoBitrate} onChange={v => set('videoBitrate', v)} />
          <Field label="Audio Bitrate"  value={form.audioBitrate} onChange={v => set('audioBitrate', v)} />
          <div>
            <label className="block text-xs text-gray-500 mb-1">Video Codec</label>
            <select
              value={form.videoCodec}
              onChange={e => set('videoCodec', e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200"
            >
              <option value="libx264">libx264</option>
              <option value="libx265">libx265</option>
              <option value="copy">copy</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Preset</label>
            <select
              value={form.preset}
              onChange={e => set('preset', e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200"
            >
              {['ultrafast','superfast','veryfast','faster','fast','medium','slow','slower','veryslow'].map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <Field label="Passphrase"     value={form.passphrase}   onChange={v => set('passphrase', v)}   type="password" />

          {error && <p className="col-span-full text-red-400 text-sm">{error}</p>}

          <div className="col-span-full flex gap-3">
            <button
              type="submit"
              disabled={loading}
              className="bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-sm px-4 py-2 rounded transition-colors"
            >
              {loading ? 'Starting…' : 'Start'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', required, className = '' }) {
  return (
    <div className={className}>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        required={required}
        className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-blue-600"
      />
    </div>
  );
}
