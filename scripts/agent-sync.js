#!/usr/bin/env node
// agent-sync.js — live-sync agent-status.md from git/GitHub, then display dashboard
// Usage: npm run sync   OR   node scripts/agent-sync.js [--dry-run]

'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DRY_RUN = process.argv.includes('--dry-run');
const REPO_ROOT = path.resolve(__dirname, '..');
const STATUS_FILE = path.join(REPO_ROOT, 'docs', 'agent-status.md');

// ── ANSI colours ──────────────────────────────────────────────────────────────
const R = '\x1b[0;31m', G = '\x1b[0;32m', Y = '\x1b[1;33m';
const C = '\x1b[0;36m', B = '\x1b[1m', Z = '\x1b[0m';

function hr() { return '───────────────────────────────────────────────────────'; }
function run(cmd) {
  try { return execSync(cmd, { cwd: REPO_ROOT, encoding: 'utf8' }).trim(); }
  catch { return ''; }
}

// ── 1. Fetch live PR data from GitHub ────────────────────────────────────────
let prs = [];
try {
  const raw = run('gh pr list --state all --limit 40 --json number,title,headRefName,state,mergedAt');
  prs = JSON.parse(raw || '[]');
} catch {
  console.error(`${R}ERROR: gh CLI not available or not authenticated.${Z}`);
  process.exit(1);
}

const mergedPrs = prs
  .filter(p => p.state === 'MERGED')
  .sort((a, b) => new Date(a.mergedAt) - new Date(b.mergedAt));
const openPrs = prs.filter(p => p.state === 'OPEN');

// ── 2. Read status file ───────────────────────────────────────────────────────
if (!fs.existsSync(STATUS_FILE)) {
  console.error(`ERROR: ${STATUS_FILE} not found`); process.exit(1);
}
let doc = fs.readFileSync(STATUS_FILE, 'utf8');

// ── 3. Determine agent from branch prefix ────────────────────────────────────
function branchAgent(branch) {
  if (!branch) return 'operator';
  if (branch.startsWith('cursor/')) return 'B';
  if (branch.startsWith('idx/'))    return 'C';
  return 'A';
}

// ── 4. Parse PR numbers already in the merge log ─────────────────────────────
function mergeLogPrNums(content) {
  const nums = new Set();
  for (const m of content.matchAll(/\| #(\d+) \|/g)) nums.add(Number(m[1]));
  return nums;
}

// ── 5. Add missing merged PRs to the merge log table ─────────────────────────
const existing = mergeLogPrNums(doc);
const toAdd = mergedPrs.filter(p => !existing.has(p.number));
const changes = [];

if (toAdd.length > 0) {
  const rows = toAdd.map(pr => {
    const date  = pr.mergedAt.slice(0, 10);
    const agent = branchAgent(pr.headRefName);
    const what  = pr.title.slice(0, 50);
    return `| ${date} | ${agent} | ${pr.headRefName} | #${pr.number} | ${what} |`;
  }).join('\n');

  // Insert after the merge log table header separator row
  const headerRe = /(\| Date \| Agent \| Branch \| PR \| What merged \|\n\|[-| ]+\|)(\n)/;
  if (headerRe.test(doc)) {
    doc = doc.replace(headerRe, `$1\n${rows}$2`);
    changes.push(`Added ${toAdd.length} merge log row(s): ${toAdd.map(p => '#' + p.number).join(', ')}`);
  }
}

// ── 6. Detect stale agent task sections and annotate ─────────────────────────
const mergedBranches = new Set(mergedPrs.map(p => p.headRefName));

function detectStaleAgent(content, agentLabel) {
  // Match "Active branch:" line and extract the first backtick-quoted or plain word
  const re = new RegExp(
    `(## AGENT ${agentLabel} STATUS[\\s\\S]*?\\*\\*Active branch:\\*\\*)([^\\n]+)`, 'm'
  );
  const m = re.exec(content);
  if (!m) return { branch: null, merged: false };
  // Extract branch name — strip backticks, take first token before spaces/arrows
  const raw = m[2].replace(/`/g, '').trim().split(/[\s→]/)[0];
  return { branch: raw, merged: mergedBranches.has(raw) };
}

const staleA = detectStaleAgent(doc, 'A');
const staleB = detectStaleAgent(doc, 'B');

// Update "Last session" date to today's actual merge date when branch is merged
function updateLastSession(content, agentLabel, prNumber) {
  const pr = mergedPrs.find(p => p.number === prNumber);
  if (!pr) return content;
  const date = pr.mergedAt.slice(0, 10);
  const re = new RegExp(
    `(## AGENT ${agentLabel} STATUS[\\s\\S]*?\\*\\*Last session:\\*\\*)[^\\n]+`, 'm'
  );
  return content.replace(re, `$1 ${date}`);
}

// ── 7. Write back if changed ──────────────────────────────────────────────────
if (changes.length > 0 && !DRY_RUN) {
  fs.writeFileSync(STATUS_FILE, doc, 'utf8');
}

// ── 8. Parse sections from (possibly updated) doc ────────────────────────────
function parseGates(content) {
  const section = content.match(/## CURRENT PHASE GATES[\s\S]*?(?=\n---)/)?.[0] ?? '';
  const gates = [];
  for (const row of section.split('\n')) {
    const m = row.match(/^\| \*\*([^*]+)\*\* — ([^|]+)\| (✅ CLEARED|⛔ BLOCKED|⏳ PENDING|[^|]*)\|/);
    if (m) gates.push({ name: m[1].trim() + ' — ' + m[2].trim(), status: m[3].trim() });
  }
  return gates;
}

function getField(content, sectionFragment, fieldName) {
  const sectionRe = new RegExp(`## ${sectionFragment}[\\s\\S]*?(?=\\n---)`, 'm');
  const section = content.match(sectionRe)?.[0] ?? '';
  const lineRe = new RegExp(`\\*\\*${fieldName}[^*]*\\*\\*\\s*(.+)`);
  return section.match(lineRe)?.[1]?.trim() ?? '';
}

function parseQA(content) {
  const section = content.match(/## AGENT Q&A LOG[\s\S]*?(?=\n---)/)?.[0] ?? '';
  const unanswered = [];
  for (const row of section.split('\n')) {
    if (/^\| \d/.test(row) && !row.includes('ANSWERED')) {
      const parts = row.split('|').map(s => s.trim());
      if (parts.length >= 5) unanswered.push({ num: parts[1], asker: parts[2], q: parts[3] });
    }
  }
  return unanswered;
}

function parseMergeRows(content) {
  const section = content.match(/## MERGE LOG[\s\S]*?(?=\n---|\n## KNOWN)/)?.[0] ?? '';
  const rows = [];
  for (const row of section.split('\n')) {
    if (/^\| 202/.test(row)) {
      const parts = row.split('|').map(s => s.trim());
      if (parts.length >= 6) rows.push({ date: parts[1], agent: parts[2], what: parts[5] });
    }
  }
  return rows.slice(-6); // last 6
}

const gates    = parseGates(doc);
const taskA    = getField(doc, 'AGENT A STATUS', 'Current task');
const branchA  = getField(doc, 'AGENT A STATUS', 'Active branch');
const lastA    = getField(doc, 'AGENT A STATUS', 'Last session');
const taskB    = getField(doc, 'AGENT B STATUS', 'Current task');
const branchB  = getField(doc, 'AGENT B STATUS', 'Active branch');
const lastB    = getField(doc, 'AGENT B STATUS', 'Last session');
const qa       = parseQA(doc);
const mergeLog = parseMergeRows(doc);

// ── 9. Display dashboard ──────────────────────────────────────────────────────
const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

console.log('');
console.log(`${B}═══════════════════════════════════════════════════════${Z}`);
console.log(`${B}  LABOTECH — AGENT COLLABORATION STATUS${Z}`);
console.log(`${B}  ${now}${Z}`);
if (changes.length > 0) {
  if (DRY_RUN) console.log(`${Y}  [DRY RUN — no file written]${Z}`);
  else console.log(`${G}  ✓ agent-status.md updated (${changes.length} change(s))${Z}`);
}
console.log(`${B}═══════════════════════════════════════════════════════${Z}`);

// Phase gates
console.log(`\n${B}PHASE GATES${Z}\n${hr()}`);
if (gates.length === 0) {
  // Fallback: raw grep
  const raw = doc.match(/## CURRENT PHASE GATES[\s\S]*?(?=\n---)/)?.[0] ?? '';
  const rows = raw.split('\n').filter(l => /^\|/.test(l) && /Phase/.test(l));
  for (const row of rows) {
    const cells = row.split('|').map(s => s.trim());
    const gate = cells[1]?.replace(/\*/g, '') ?? '';
    const st   = cells[3] ?? '';
    const col  = st.includes('CLEARED') ? G : st.includes('BLOCKED') ? R : Y;
    const label = st.includes('CLEARED') ? 'CLEARED' : st.includes('BLOCKED') ? 'BLOCKED' : 'PENDING';
    console.log(`  ${col}${label}${Z}  ${gate.slice(0, 60)}`);
  }
} else {
  for (const g of gates) {
    const col   = g.status.includes('CLEARED') ? G : g.status.includes('BLOCKED') ? R : Y;
    const label = g.status.includes('CLEARED') ? 'CLEARED' : g.status.includes('BLOCKED') ? 'BLOCKED' : 'PENDING';
    console.log(`  ${col}${label}${Z}  ${g.name.slice(0, 60)}`);
  }
}

// Agent A
console.log(`\n${B}${C}AGENT A — Claude Code${Z}\n${hr()}`);
console.log(`  Task   : ${Y}${taskA || 'unknown'}${Z}`);
console.log(`  Branch : ${branchA || 'none'}${staleA.merged ? ` ${Y}← MERGED, update status${Z}` : ''}`);
console.log(`  Last   : ${lastA || 'unknown'}`);

// Agent B
console.log(`\n${B}${C}AGENT B — Cursor${Z}\n${hr()}`);
console.log(`  Task   : ${Y}${taskB || 'unknown'}${Z}`);
console.log(`  Branch : ${branchB || 'none'}${staleB.merged ? ` ${Y}← MERGED, update status${Z}` : ''}`);
console.log(`  Last   : ${lastB || 'unknown'}`);

// Open PRs
if (openPrs.length > 0) {
  console.log(`\n${B}OPEN PULL REQUESTS${Z}\n${hr()}`);
  for (const pr of openPrs) {
    const agent = branchAgent(pr.headRefName);
    console.log(`  ${C}#${pr.number}${Z} [Agent ${agent}]  ${pr.title.slice(0, 52)}`);
    console.log(`           ${pr.headRefName}`);
  }
}

// Operator actions
console.log(`\n${B}OPERATOR ACTION NEEDED${Z}\n${hr()}`);
let actions = 0;

if (doc.includes('⛔ BLOCKED') || doc.includes('BLOCKED')) {
  console.log(`  ${R}► Unblock gate(s) marked BLOCKED above${Z}`); actions++;
}
if (openPrs.length > 0) {
  for (const pr of openPrs) {
    console.log(`  ${Y}► PR #${pr.number} open — review and merge: ${pr.title.slice(0, 44)}${Z}`); actions++;
  }
}
if (staleA.merged) {
  console.log(`  ${Y}► Agent A status is stale — branch ${staleA.branch} is merged${Z}`); actions++;
}
if (staleB.merged) {
  console.log(`  ${Y}► Agent B status is stale — branch ${staleB.branch} is merged${Z}`); actions++;
}
if (qa.length > 0) {
  console.log(`\n  ${Y}► Unanswered questions in Q&A log:${Z}`);
  for (const q of qa) {
    console.log(`    Q${q.num} (asked by ${q.asker}): ${q.q.slice(0, 60)}`);
  }
  actions++;
}
if (actions === 0) console.log(`  ${G}None — both agents active or idle${Z}`);

// Recent merges
console.log(`\n${B}RECENT MERGES${Z}\n${hr()}`);
if (mergeLog.length === 0) {
  // fallback: show from git
  const gitLog = run('git log --merges --format="%ad  %s" --date=short -5');
  gitLog.split('\n').filter(Boolean).forEach(l => console.log(`  ${l.slice(0, 70)}`));
} else {
  for (const row of mergeLog.slice(-5)) {
    console.log(`  ${row.date}  [${row.agent}]  ${(row.what || '').slice(0, 48)}`);
  }
}

// What was synced
if (changes.length > 0) {
  console.log(`\n${B}SYNC CHANGES${Z}\n${hr()}`);
  for (const c of changes) console.log(`  ${G}+${Z} ${c}`);
}

console.log('');
console.log(`${B}═══════════════════════════════════════════════════════${Z}`);
console.log(`  Full detail: ${C}docs/agent-status.md${Z}`);
if (DRY_RUN) console.log(`  ${Y}Dry run — re-run without --dry-run to apply changes${Z}`);
console.log(`${B}═══════════════════════════════════════════════════════${Z}`);
console.log('');
