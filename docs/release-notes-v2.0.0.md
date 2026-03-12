# Labotech v2.0.0 Release Notes

Date: 2026-03-12

## Highlights

- Broadcast UI revamp applied across core operator panels using shared `BroadcastUI` tokens and atoms.
- Decoder workflow upgraded with production-ready monitoring controls and ETR 290 operational tuning.
- ETR 290 configuration is now runtime-adjustable and profile-driven (no database required).
- Frontend and backend versions bumped to `2.0.0`.

## UI and Operator Workflow Updates

- Updated panels to the new broadcast UI style:
  - TS Analyser
  - Live View
  - Transcoder
  - Runtime/Streams
  - Stream Configuration
  - Forwarder/Multicast
  - Alarm Log
  - Decoder (revamped)
- Unified service status labels in UI to:
  - `RUNNING`
  - `OFFLINE`
- User-facing wording updated to avoid "encoder" terminology in key forms and API explorer labels.

## ETR 290 Enhancements

- Added monitor tuning controls in Decoder revamp UI:
  - Include PID list
  - Exclude PID list
  - Per-check thresholds
  - Allow/deny unknown-PID evidence
  - Save/delete/apply profiles
- Added profile persistence on disk:
  - `config/etr290-profiles.json`
- Added profile store service:
  - `src/etr290-profile-store.js`
- Added ETR 290 API endpoints:
  - `GET /etr290/profiles`
  - `POST /etr290/profiles`
  - `DELETE /etr290/profiles/:name`
  - `PUT /etr290/:id/config`
- Extended `POST /etr290/start` to accept profile/config payload.

## Compatibility and Safety

- Existing TS analysis and ETR websocket flow remains active.
- Runtime state remains in-memory for active monitors/processes.
- Profile persistence is file-based only (no DB/ORM introduced).

## Validation Performed

- Backend tests: 122/122 passing.
- Frontend production build: successful.
- Docker Compose deployment validated on local host after daemon availability.

## Changed Files (v2.0.0 scope)

- `package.json`
- `web/package.json`
- `web/src/App.jsx`
- `web/src/components/DecoderPanelRevamp.jsx`
- `web/src/components/EncoderForm.jsx`
- `web/src/components/APIPanel.jsx`
- `web/src/hooks/useETR290.js`
- `web/src/api.js`
- `routes/etr290.js`
- `src/etr290-analyser.js`
- `src/etr290-profile-store.js`
- `config/etr290-profiles.json`
- `test/etr290-analyser.test.js`
