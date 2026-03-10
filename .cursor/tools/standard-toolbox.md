# Standard Toolbox Commands

## Backend

- Install: `npm install`
- Test all: `npm test`
- Run API: `npm start`

## Frontend

- Install: `cd web && npm install`
- Dev server: `cd web && npm run dev`
- Production build: `cd web && npm run build`

## Docker

- Production stack: `docker-compose up -d`
- Dev stack: `docker-compose -f docker-compose.dev.yml up`

## Host Checks

- Host setup: `sudo bash scripts/setup-host.sh`
- Multicast routes: `sudo bash scripts/check-routes.sh`
