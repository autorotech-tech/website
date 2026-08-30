#!/bin/bash
# Deploy swoop with Social Crossposting + all dashboard updates
# Run from: website/

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

REMOTE="vladx@46.250.228.229"
SSH="ssh -i $HOME/.ssh/id_ed25519_autoro"
SCP="scp -i $HOME/.ssh/id_ed25519_autoro"
# autoro-frontend container runs from this path (docker inspect com.docker.compose.project.working_dir)
DEST="/home/vladx/autoro-dashboard"

echo "📤 Deploying swoop (Layout, App, Blog Admin, Editor, Settings)..."

# Copy core layout/app and blog admin components
$SCP src/components/Layout.tsx $REMOTE:$DEST/src/components/
$SCP src/components/Login.tsx $REMOTE:$DEST/src/components/
$SCP src/components/SocialCrossposting.tsx $REMOTE:$DEST/src/components/
$SCP src/components/BlogAdmin.tsx $REMOTE:$DEST/src/components/
$SCP src/components/BlogPostEditor.tsx $REMOTE:$DEST/src/components/
$SCP src/components/BlogSettings.tsx $REMOTE:$DEST/src/components/
$SCP src/components/BlogPostGenerator.tsx $REMOTE:$DEST/src/components/
$SCP src/components/AdminScrapling.tsx $REMOTE:$DEST/src/components/
$SCP src/components/AdminPerplexica.tsx $REMOTE:$DEST/src/components/
$SCP src/App.tsx $REMOTE:$DEST/src/

echo "✅ Files copied. Rebuilding..."
$SSH $REMOTE "cd $DEST && docker-compose build frontend && docker-compose up -d frontend"

echo "✅ Done! Check https://swoop.autoro.tech — Social Crossposting in Admin menu."
