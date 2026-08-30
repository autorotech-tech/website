#!/usr/bin/env bash
# Fix broken macOS PATH export on Linux VPS (~/.bashrc line with spaces in VMware Fusion path).
set -euo pipefail

REMOTE="${REMOTE:-vladx@46.250.228.229}"
KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_autoro}"
SSH_OPTS=(-i "$KEY" -o ConnectTimeout=60)

ssh "${SSH_OPTS[@]}" "$REMOTE" bash -s <<'REMOTE'
set -euo pipefail
cp -a ~/.bashrc ~/.bashrc.bak.$(date +%Y%m%d%H%M%S)

python3 <<'PY'
from pathlib import Path
p = Path.home() / ".bashrc"
text = p.read_text()
lines = text.splitlines()
out = []
seen_nvm = 0
for line in lines:
    if line.startswith("export PATH=/Users/"):
        continue
    if line.strip() == 'export NVM_DIR="$HOME/.nvm"':
        seen_nvm += 1
        if seen_nvm > 1:
            continue
    out.append(line)

block = """
# Linux PATH (autoro VPS — do not paste macOS PATH here)
export PATH="$HOME/bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
"""
if not any("Linux PATH (autoro VPS" in l for l in out):
    out.append(block.strip())

p.write_text("\n".join(out).rstrip() + "\n")
print("Fixed ~/.bashrc")
PY

bash -n ~/.bashrc && echo "bash -n OK"
REMOTE

echo "✅ VPS .bashrc fixed. Reconnect SSH to verify."
