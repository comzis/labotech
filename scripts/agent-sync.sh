#!/usr/bin/env bash
# agent-sync.sh — show current agent collaboration state
# Usage: npm run sync   OR   bash scripts/agent-sync.sh

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATUS_FILE="$REPO_ROOT/docs/agent-status.md"

if [[ ! -f "$STATUS_FILE" ]]; then
  echo "ERROR: docs/agent-status.md not found" >&2; exit 1
fi

RED='\033[0;31m'; GRN='\033[0;32m'; YLW='\033[1;33m'
CYN='\033[0;36m'; BLD='\033[1m'; RST='\033[0m'

hr() { echo "───────────────────────────────────────────────────────"; }

# Extract a field from a named section of the status file
# Usage: get_field "SECTION HEADING FRAGMENT" "Field name"
get_field() {
  local section="$1" field="$2"
  awk "/^## .*${section}/,/^---/" "$STATUS_FILE" \
    | grep -i "^\*\*${field}" | head -1 \
    | sed 's/^[*][*][^*]*[*][*] *//' | sed 's/^[[:space:]]*//' || echo ""
}

echo ""
echo -e "${BLD}═══════════════════════════════════════════════════════${RST}"
echo -e "${BLD}  LABOTECH — AGENT COLLABORATION STATUS${RST}"
echo -e "${BLD}  $(date '+%Y-%m-%d %H:%M:%S')${RST}"
echo -e "${BLD}═══════════════════════════════════════════════════════${RST}"

# ── phase gates (read only the table inside CURRENT PHASE GATES section) ──────
echo ""
echo -e "${BLD}PHASE GATES${RST}"; hr
awk '/^## CURRENT PHASE GATES/,/^---/' "$STATUS_FILE" \
  | grep -E '^\| \*\*' \
  | while IFS='|' read -r _ gate gate_status _rest; do
      gate=$(echo "$gate" | sed 's/\*//g' | xargs)
      gate_status=$(echo "$gate_status" | xargs)
      if echo "$gate_status" | grep -q 'CLEARED'; then
        printf "  ${GRN}CLEARED${RST}  %s\n" "$gate"
      elif echo "$gate_status" | grep -q 'BLOCKED'; then
        printf "  ${RED}BLOCKED${RST}  %s\n" "$gate"
      elif echo "$gate_status" | grep -q 'PENDING'; then
        printf "  ${YLW}PENDING${RST}  %s\n" "$gate"
      else
        printf "  %-8s  %s\n" "$gate_status" "$gate"
      fi
    done

# ── agent a ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${BLD}${CYN}AGENT A — Claude Code${RST}"; hr
TASK_A=$(get_field "AGENT A" "Current task")
BRANCH_A=$(get_field "AGENT A" "Active branch")
LAST_A=$(get_field "AGENT A" "Last session")
echo -e "  Task   : ${YLW}${TASK_A:-unknown}${RST}"
echo    "  Branch : ${BRANCH_A:-none}"
echo    "  Last   : ${LAST_A:-unknown}"

# ── agent b ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${BLD}${CYN}AGENT B — Cursor${RST}"; hr
TASK_B=$(get_field "AGENT B" "Current task")
BRANCH_B=$(get_field "AGENT B" "Active branch")
LAST_B=$(get_field "AGENT B" "Last session")
echo -e "  Task   : ${YLW}${TASK_B:-unknown}${RST}"
echo    "  Branch : ${BRANCH_B:-none}"
echo    "  Last   : ${LAST_B:-unknown}"

# ── operator actions ──────────────────────────────────────────────────────────
echo ""
echo -e "${BLD}OPERATOR ACTION NEEDED${RST}"; hr
ACTIONS=0

GATES_SECTION=$(awk '/^## CURRENT PHASE GATES/,/^---/' "$STATUS_FILE")

if echo "$GATES_SECTION" | grep -q 'BLOCKED'; then
  echo -e "  ${RED}► Unblock gate(s) marked BLOCKED above${RST}"
  ACTIONS=$((ACTIONS+1))
fi
if echo "$GATES_SECTION" | grep -q 'PENDING'; then
  echo -e "  ${YLW}► Review and merge pending PR, then clear PENDING gate${RST}"
  ACTIONS=$((ACTIONS+1))
fi
if echo "$TASK_B" | grep -qiE 'awaiting|checklist ready|waiting'; then
  echo -e "  ${YLW}► Cursor is waiting — check Agent B status above${RST}"
  ACTIONS=$((ACTIONS+1))
fi
if [[ $ACTIONS -eq 0 ]]; then
  echo -e "  ${GRN}None — both agents are active or idle${RST}"
fi

# ── recent merges ─────────────────────────────────────────────────────────────
echo ""
echo -e "${BLD}RECENT MERGES${RST}"; hr
awk '/^## MERGE LOG/,/^## KNOWN/' "$STATUS_FILE" \
  | grep '| 202' | tail -5 \
  | while IFS='|' read -r _ date agent branch pr what _; do
      printf "  %-12s %-12s %s\n" \
        "$(echo "$date" | xargs)" \
        "$(echo "$agent" | xargs)" \
        "$(echo "$what" | xargs | cut -c1-48)"
    done

echo ""
echo -e "${BLD}═══════════════════════════════════════════════════════${RST}"
echo -e "  Full detail: ${CYN}docs/agent-status.md${RST}"
echo -e "  Phase 1 checklist: ${CYN}cursor/phase0a-tsduck-findings${RST} branch"
echo -e "${BLD}═══════════════════════════════════════════════════════${RST}"
echo ""
