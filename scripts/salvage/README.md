# Salvage System

External wrapper that automatically summarizes failed zeroshot clusters using Claude.

## Problem Solved

When a multi-agent cluster times out or fails before the synthesizer runs, no report is generated. The salvage system catches these failures and runs Claude to extract whatever work was completed.

## Installation

```bash
# Create directories
mkdir -p ~/.local/bin ~/.zeroshot/scripts

# Copy scripts
cp scripts/salvage/zs ~/.local/bin/zs
cp scripts/salvage/salvage.sh ~/.zeroshot/scripts/salvage.sh

# Make executable
chmod +x ~/.local/bin/zs ~/.zeroshot/scripts/salvage.sh

# Add to PATH (add to .bashrc or .zshrc for persistence)
export PATH="$HOME/.local/bin:$PATH"
```

## Usage

Use `zs` instead of `zeroshot`:

```bash
# These all work identically to zeroshot
zs run 123
zs run 123 --worktree
zs run 123 --pr
zs run "research topic" --config high-power-research

# If the cluster fails, a salvage report is automatically generated
```

## How It Works

1. `zs` runs `zeroshot` with all arguments, capturing output
2. If zeroshot exits with non-zero status:
   - Extracts the cluster ID from output
   - Calls `salvage.sh` with the cluster ID
3. `salvage.sh`:
   - Exports the cluster's message ledger
   - Runs Claude to analyze what was attempted
   - Saves a summary report

## Output Files

The salvage report is named based on context:

- If the original task mentioned an output file: `<filename>_SALVAGED.<ext>`
- Otherwise: `SALVAGED_<cluster-id>.md`

## Requirements

- `claude` CLI installed and configured
- `jq` installed (for JSON parsing)
- `zeroshot` installed

## Manual Usage

You can also run salvage manually on any cluster:

```bash
~/.zeroshot/scripts/salvage.sh <cluster-id>
```
