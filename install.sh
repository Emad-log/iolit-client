#!/usr/bin/env bash
# Iolit client installer. Usage: curl -fsSL iolit.dev/install | sh
# Installs to ~/.iolit/bin, adds itself to PATH via shell rc.

set -e

VERSION="${IOLIT_VERSION:-main}"
INSTALL_DIR="$HOME/.iolit"
BIN_DIR="$INSTALL_DIR/bin"
TMP_DIR="$INSTALL_DIR/tmp"
REPO="https://github.com/Emad-log/iolit-client.git"

echo "Installing Iolit client ($VERSION)..."

mkdir -p "$BIN_DIR" "$TMP_DIR"

# Require node (node:sqlite needs 22.13+)
if ! command -v node >/dev/null 2>&1; then
  echo "Error: Node.js >= 22.13 required. Install it first: https://nodejs.org"
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
NODE_MINOR="$(node -p 'process.versions.node.split(".")[1]')"
if [ "$NODE_MAJOR" -lt 22 ] || { [ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -lt 13 ]; }; then
  echo "Error: Node.js >= 22.13 required (node:sqlite). Found $(node -v)."
  exit 1
fi

# Clone (shallow) or update. Fail loudly: swallowing git's stderr here
# used to leave users with a half-installed tree and no clue why.
if [ -d "$INSTALL_DIR/repo/.git" ]; then
  if ! git -C "$INSTALL_DIR/repo" fetch --depth 1 origin "$VERSION" 2>"$TMP_DIR/git.log"; then
    echo "Error: failed to fetch $VERSION from $REPO"
    cat "$TMP_DIR/git.log"
    exit 1
  fi
  git -C "$INSTALL_DIR/repo" checkout -q FETCH_HEAD
else
  if ! git clone --depth 1 --branch "$VERSION" "$REPO" "$INSTALL_DIR/repo" 2>"$TMP_DIR/git.log"; then
    echo "Error: failed to clone $REPO"
    cat "$TMP_DIR/git.log"
    exit 1
  fi
fi

# Build. Drop dist first: tsc never deletes outputs, so an update that
# removed a source file would otherwise leave its stale JS behind.
cd "$INSTALL_DIR/repo"
npm install --silent
rm -rf dist
npm run build

# Symlink the CLI
ln -sf "$INSTALL_DIR/repo/dist/cli.js" "$BIN_DIR/iolit"
chmod +x "$BIN_DIR/iolit"

# Add to PATH, exactly once. Checking $PATH alone is not enough: a
# reinstall from a shell that never sourced the rc file would otherwise
# append a duplicate export line on every run.
add_path_once() {
  local rc="$1"
  local line="export PATH=\"$BIN_DIR:\$PATH\""
  grep -qxF "$line" "$rc" 2>/dev/null || echo "$line" >> "$rc"
}
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) add_path_once "$HOME/.bashrc"
     add_path_once "$HOME/.zshrc" ;;
esac

echo ""
echo "Done. Run: iolit"
echo "See past batches: iolit history"
