#!/usr/bin/env bash
# ==============================================================================
# Folio (Fox Pet) — Unified Installer for Omarchy & DeepSeek Harness (DSH)
# Usage:
#   ./install.sh          # Installs both Omarchy and DSH targets (auto-detected)
#   ./install.sh omarchy  # Installs Omarchy desktop overlay plugin only
#   ./install.sh dsh      # Installs DSH web/runtime plugin dependencies only
# ==============================================================================
set -euo pipefail

TARGET="${1:-all}"
REPO_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)

echo "=== Folio Fox Pet Installer ==="

install_dsh() {
  echo "[1/2] Installing DeepSeek Harness (DSH) components..."
  if [ -d "$REPO_DIR/dsh" ]; then
    if ! command -v node >/dev/null 2>&1; then
      echo "⚠ node not found; skipped DSH build and validation."
      return 1
    fi
    # The package has no runtime dependencies: lib/client.js is built from
    # fox-pet.client.js by a plain node script, so this needs no network.
    echo " -> Building client bundle..."
    node "$REPO_DIR/dsh/test/build-bundle.mjs"
    echo " -> Running test validation..."
    npm --prefix "$REPO_DIR/dsh" test
    npm --prefix "$REPO_DIR/dsh" run verify:deployed
    echo "✔ DSH Fox Pet runtime ready."
  fi
}

install_omarchy() {
  echo "[2/2] Installing Omarchy Desktop Companion Plugin..."
  local plugins_dir="${HOME:?}/.config/omarchy/plugins"
  local target="$plugins_dir/fox-pet"
  local backup_root="$HOME/.local/state/omarchy/fox-pet/plugin-backups"

  if ! command -v jq >/dev/null 2>&1; then
    echo "⚠ jq is required for Omarchy installation. Please install jq (e.g. sudo apt install jq)."
    return 1
  fi

  for file in Service.qml Panel.qml SpriteView.qml BarWidget.qml assets/pet.json assets/spritesheet.webp; do
    [[ -f "$REPO_DIR/$file" ]] || { echo "Error: Missing release file: $file" >&2; return 1; }
  done

  mkdir -p -- "$plugins_dir" "$backup_root"
  local stage
  stage=$(mktemp -d "$plugins_dir/.fox-pet.install.XXXXXXXX")
  local release_hash
  release_hash=$(cd -- "$REPO_DIR" && sha256sum -- *.qml manifest.json assets/pet.json assets/spritesheet.webp | sha256sum)
  local release="release-${release_hash:0:16}"
  mkdir -p -- "$stage/$release"
  cp -- "$REPO_DIR/"*.qml "$stage/$release/"
  cp -a -- "$REPO_DIR/assets" "$stage/$release/assets"
  jq --arg release "$release/" '.entryPoints |= with_entries(.value = $release + .value)' \
    "$REPO_DIR/manifest.json" > "$stage/manifest.json"

  local backup
  backup=$(mktemp -d "$backup_root/install.XXXXXXXX")

  shopt -s nullglob dotglob
  for candidate in "$plugins_dir"/*; do
    [[ "$candidate" != "$stage" && -f "$candidate/manifest.json" ]] || continue
    if jq -e '.id == "fox-pet"' "$candidate/manifest.json" >/dev/null 2>&1; then
      local name=${candidate##*/}
      mv -T -- "$candidate" "$backup/$name"
    fi
  done

  rm -rf -- "$target"
  mv -T -- "$stage" "$target"
  echo "✔ Installed Omarchy plugin at $target"

  if command -v omarchy-shell >/dev/null 2>&1 && command -v omarchy >/dev/null 2>&1; then
    if omarchy-shell shell ping >/dev/null 2>&1; then
      omarchy-shell shell rescanPlugins
      omarchy plugin enable fox-pet || true
      omarchy-shell shell summon fox-pet || true
      echo "✔ Omarchy shell reloaded with release $release."
    fi
  fi
}

case "$TARGET" in
  dsh)
    install_dsh
    ;;
  omarchy)
    install_omarchy
    ;;
  all|*)
    install_dsh
    install_omarchy
    ;;
esac

echo "============================================="
echo "✔ Installation complete!"
