# Labotech — Development Workflow

Three AI coding tools are active on this repository. This document defines how they
co-exist without stepping on each other or introducing unreviewed changes to production.

---

## Tools and their lanes

| Tool | Branch prefix | Typical tasks |
|---|---|---|
| **Claude Code** (CLI) | `feat/`, `fix/`, `chore/` | Multi-file features, backend logic, deploy scripts, test suites, refactors |
| **Cursor** (local IDE) | `cursor/` | Inline editing, small targeted fixes, debugging sessions |
| **Antigravity / IDX** (Google IDE) | `idx/` | Exploratory prototypes, Google-ecosystem integrations |

---

## Branch → PR → Merge flow

```
1.  git checkout -b <prefix>/<short-description>
2.  Make changes, commit incrementally
3.  npm test -- --runInBand          # must pass
4.  npm run build --prefix web       # must be 0 warnings
5.  git push -u origin <branch>
6.  gh pr create                     # AI opens PR, returns URL
7.  Human reviews diff on GitHub
8.  Human merges PR to main
9.  Human deploys: bash scripts/update-and-deploy-safe.sh
```

**Nothing goes to `main` directly.** All three tools follow this flow.

---

## Switching tools mid-task

If you start work in Cursor and want to continue in Claude Code (or vice versa):

```bash
# In the current tool — before switching
git add -A
git commit -m "wip: <description>"
git push
```

Then pick up the branch in the other tool. Never have two tools uncommitted on the
same branch simultaneously — conflicts and lost work follow.

---

## Pre-commit safety hook

`.git/hooks/pre-commit` is installed and executable. It blocks commits that contain
known AI telemetry injection patterns:

| Pattern | Source |
|---|---|
| `127.0.0.1:7265` | Cursor AI debugger telemetry endpoint |
| `#region agent log` | Cursor instrumentation block marker |
| `antigravity.inject` | IDX/Antigravity instrumentation marker |

If a commit is rejected, inspect the diff:

```bash
git diff --cached | grep -n '7265\|agent log\|antigravity\.inject'
```

Remove the offending lines, then re-commit. **Do not use `--no-verify`** unless you
have explicitly confirmed the pattern is intentional (it never should be).

---

## Deploy flow (production server gva-boro-probe)

Only deploy from `main` after a PR has been merged:

```bash
# On server as boro
cd ~/LaboTech/labotech
git fetch --prune origin && git pull --ff-only origin main
bash scripts/update-and-deploy-safe.sh
```

The deploy script handles: disk cleanup → Docker rebuild → health check.

Use `update-and-deploy-safe.sh` — not `deploy.sh` (removed) or `deploy-ref.sh` (removed).

---

## PR checklist (copy into PR description)

```
- [ ] Tests pass: npm test -- --runInBand
- [ ] Frontend build clean: npm run build --prefix web (0 warnings)
- [ ] No AI telemetry patterns in diff (pre-commit hook passed)
- [ ] CLAUDE.md updated if new conventions introduced
- [ ] Relevant known pitfalls section updated if a new gotcha found
```
