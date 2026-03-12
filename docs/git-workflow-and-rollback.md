# Git Workflow and Rollback Plan

This runbook gives a safe workflow before testing in production and a fast rollback path.

## 1) Branch and release workflow

- Work on a feature branch from `main`.
- Open PR and merge only after tests/build pass.
- Create an annotated release tag on `main` for every production test/deploy.

Example:

```bash
git checkout main
git pull --ff-only
npm test
cd web && npm run build && cd ..
git tag -a v1.5.0 -m "Prod test v1.5.0"
git push origin main --tags
```

## 2) Pre-prod checklist

- Confirm target tag exists on remote: `git ls-remote --tags origin`
- Confirm no local changes on server: `git status --porcelain` should be empty
- Confirm service health endpoint after deploy: `curl -f http://10.67.18.29:4000/health`
- Confirm stream list endpoint: `curl -f http://10.67.18.29:4000/streams`

## 3) Deploy a specific version

Use a fixed git reference (tag preferred) to avoid ambiguous "latest pull" deploys:

```bash
bash scripts/deploy-ref.sh v1.5.0
```

## 3b) Standardized production upgrade command

Use one command for routine upgrades (defaults to `origin/main`):

```bash
bash scripts/upgrade-prod.sh
```

Or upgrade to an explicit tag/commit:

```bash
bash scripts/upgrade-prod.sh v1.5.0
```

This script:

- fetches refs/tags
- checks out the exact ref in detached HEAD
- installs dependencies
- builds frontend
- restarts `labotech` systemd service
- verifies service active state and `/health`

## 4) Rollback plan

### Option A: Rollback to previous tag automatically

```bash
bash scripts/rollback-last-tag.sh
```

### Option B: Rollback to a specific known-good tag

```bash
bash scripts/rollback-last-tag.sh v1.4.3
```

### Manual fallback

```bash
bash scripts/deploy-ref.sh v1.4.3
```

## 5) Post-rollback verification

Run immediately after rollback:

```bash
curl -f http://10.67.18.29:4000/health
curl -f http://10.67.18.29:4000/streams
sudo systemctl status labotech --no-pager -l
```

If health checks fail, keep service on prior stable tag and inspect:

```bash
sudo journalctl -u labotech -n 200 --no-pager
```

## 6) Operational notes

- Never deploy directly from untagged local edits.
- Prefer tags for every production test candidate.
- Record deployed tag and rollback tag in your change log/ticket.
