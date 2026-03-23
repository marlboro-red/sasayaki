#!/usr/bin/env bash
# setup-vault.sh — Bootstrap a local Obsidian vault for Sasayaki development/testing
#
# Usage:
#   ./scripts/setup-vault.sh [vault-path]
#
# If vault-path is omitted, creates ./test-vault in the project root.
# The script symlinks the built plugin files into the vault and ensures
# the plugin is enabled in community-plugins.json.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

green() { printf '\033[32m✓ %s\033[0m\n' "$1"; }
yellow() { printf '\033[33m→ %s\033[0m\n' "$1"; }
red() { printf '\033[31m✗ %s\033[0m\n' "$1"; }

# ─────────────────────────────────────────────────────────────────
# 1. Determine vault path
# ─────────────────────────────────────────────────────────────────
VAULT_PATH="${1:-$PROJECT_ROOT/test-vault}"

# Resolve to absolute path
case "$VAULT_PATH" in
  /*) ;; # already absolute
  *)  VAULT_PATH="$(cd "$(dirname "$VAULT_PATH")" 2>/dev/null && pwd)/$(basename "$VAULT_PATH")" \
        || VAULT_PATH="$(pwd)/$VAULT_PATH" ;;
esac

echo ""
echo "Sasayaki — Vault Setup"
echo "────────────────────────────────────────"
echo "  Project root : $PROJECT_ROOT"
echo "  Vault path   : $VAULT_PATH"
echo ""

# ─────────────────────────────────────────────────────────────────
# 2. Create vault directory structure
# ─────────────────────────────────────────────────────────────────
PLUGIN_DIR="$VAULT_PATH/.obsidian/plugins/sasayaki"

mkdir -p "$VAULT_PATH/.obsidian/plugins"
green "Vault directory ready: $VAULT_PATH"

# ─────────────────────────────────────────────────────────────────
# 3. Build the plugin if main.js is missing or stale
# ─────────────────────────────────────────────────────────────────
if [ ! -f "$PROJECT_ROOT/main.js" ]; then
  yellow "main.js not found — building plugin..."
  (cd "$PROJECT_ROOT" && npm install && npm run build)
  green "Plugin built"
else
  green "main.js exists (run 'npm run build' to rebuild)"
fi

# ─────────────────────────────────────────────────────────────────
# 4. Symlink plugin into vault
# ─────────────────────────────────────────────────────────────────
if [ -L "$PLUGIN_DIR" ]; then
  EXISTING_TARGET="$(readlink "$PLUGIN_DIR")"
  if [ "$EXISTING_TARGET" = "$PROJECT_ROOT" ]; then
    green "Symlink already correct: $PLUGIN_DIR → $PROJECT_ROOT"
  else
    yellow "Symlink exists but points to $EXISTING_TARGET — updating..."
    rm "$PLUGIN_DIR"
    ln -s "$PROJECT_ROOT" "$PLUGIN_DIR"
    green "Symlink updated: $PLUGIN_DIR → $PROJECT_ROOT"
  fi
elif [ -d "$PLUGIN_DIR" ]; then
  red "$PLUGIN_DIR already exists as a directory (not a symlink)"
  echo "  Remove it manually if you want this script to manage it:"
  echo "    rm -rf \"$PLUGIN_DIR\""
  exit 1
else
  ln -s "$PROJECT_ROOT" "$PLUGIN_DIR"
  green "Symlink created: $PLUGIN_DIR → $PROJECT_ROOT"
fi

# ─────────────────────────────────────────────────────────────────
# 5. Enable plugin in community-plugins.json
# ─────────────────────────────────────────────────────────────────
COMMUNITY_PLUGINS="$VAULT_PATH/.obsidian/community-plugins.json"

if [ ! -f "$COMMUNITY_PLUGINS" ]; then
  echo '["sasayaki"]' > "$COMMUNITY_PLUGINS"
  green "Created community-plugins.json with sasayaki enabled"
else
  # Check if sasayaki is already in the list
  if python3 -c "
import json, sys
with open('$COMMUNITY_PLUGINS') as f:
    plugins = json.load(f)
sys.exit(0 if 'sasayaki' in plugins else 1)
" 2>/dev/null; then
    green "sasayaki already enabled in community-plugins.json"
  else
    python3 -c "
import json
with open('$COMMUNITY_PLUGINS') as f:
    plugins = json.load(f)
plugins.append('sasayaki')
with open('$COMMUNITY_PLUGINS', 'w') as f:
    json.dump(plugins, f, indent=2)
"
    green "Added sasayaki to community-plugins.json"
  fi
fi

# ─────────────────────────────────────────────────────────────────
# 6. Whisper model check
# ─────────────────────────────────────────────────────────────────
echo ""
WHISPER_DIR=""
for candidate in "$HOME/whisper.cpp" "$PROJECT_ROOT/../whisper.cpp"; do
  if [ -d "$candidate/models" ]; then
    WHISPER_DIR="$(cd "$candidate" && pwd)"
    break
  fi
done

MODEL_FOUND=false
if [ -n "$WHISPER_DIR" ]; then
  # Look for any .bin model file
  for model in "$WHISPER_DIR"/models/ggml-*.bin; do
    if [ -f "$model" ]; then
      green "Found whisper model: $model"
      MODEL_FOUND=true
      break
    fi
  done
fi

if [ "$MODEL_FOUND" = false ]; then
  yellow "No whisper.cpp model found"
  echo ""
  echo "  To download a model:"
  echo "    cd /path/to/whisper.cpp"
  echo "    ./models/download-ggml-model.sh small"
  echo ""
  echo "  See whisper/README.md for full build & setup instructions."
fi

# ─────────────────────────────────────────────────────────────────
# 7. Print next steps
# ─────────────────────────────────────────────────────────────────
echo ""
echo "────────────────────────────────────────"
echo "  Setup complete!"
echo "────────────────────────────────────────"
echo ""
echo "Next steps:"
echo ""
echo "  1. Open the vault in Obsidian:"
echo "       Open Obsidian → Open folder as vault → $VAULT_PATH"
echo ""
echo "  2. Enable community plugins:"
echo "       Settings → Community plugins → Turn on community plugins"
echo ""
echo "  3. Start whisper-server (if not using auto-start):"
echo "       See whisper/README.md for instructions"
echo ""
echo "  4. For development with hot-reload:"
echo "       npm run dev"
echo "       (Obsidian will pick up changes on reload: Cmd+R)"
echo ""
