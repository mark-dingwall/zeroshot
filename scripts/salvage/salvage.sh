#!/bin/bash
# salvage.sh - Summarize failed zeroshot clusters using Claude
#
# Called automatically by the zs wrapper when a cluster fails.
# Can also be run manually: salvage.sh <cluster-id> [original-command]
#
# REQUIREMENTS:
#   - claude CLI must be installed and configured
#   - jq must be installed
#   - zeroshot must be installed

CLUSTER_ID="$1"
ORIGINAL_COMMAND="$2"

if [ -z "$CLUSTER_ID" ]; then
    echo "Usage: salvage.sh <cluster-id> [original-command]"
    exit 1
fi

TEMP_LEDGER=$(mktemp --suffix=.json)
zeroshot export "$CLUSTER_ID" --format json > "$TEMP_LEDGER"

# Try to find original target filename from the issue
ORIGINAL_TARGET=$(jq -r '
  .messages[]?
  | select(.topic=="ISSUE_OPENED")
  | .content.text // ""
' "$TEMP_LEDGER" 2>/dev/null | grep -oiE '(write|save|output)[^.]*\.(md|json|txt|log)' | grep -oE '[^ ]+\.(md|json|txt|log)' | head -1)

if [ -n "$ORIGINAL_TARGET" ]; then
    BASE="${ORIGINAL_TARGET%.*}"
    EXT="${ORIGINAL_TARGET##*.}"
    SALVAGE_FILE="${BASE}_SALVAGED.${EXT}"
else
    SALVAGE_FILE="SALVAGED_${CLUSTER_ID}.md"
fi

claude -p "A zeroshot multi-agent cluster failed to complete normally.

**Original command:** $ORIGINAL_COMMAND
**Cluster ID:** $CLUSTER_ID
**Ledger file:** $TEMP_LEDGER

Read the ledger file and:
1. Summarize what work was attempted
2. List any findings with their verification status
3. Identify what remained unresolved
4. Note patterns in why consensus wasn't reached (if applicable)

Save the summary to: $SALVAGE_FILE"

rm -f "$TEMP_LEDGER"
echo "Salvage report: $SALVAGE_FILE"
