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

# Clone (shallow) or update
if [ -d "$INSTALL_DIR/repo/.git" ]; then
  git -C "$INSTALL_DIR/repo" fetch --depth 1 origin "$VERSION" >/dev/null 2>&1
  git -C "$INSTALL_DIR/repo" checkout -q FETCH_HEAD
else
  git clone --depth 1 --branch "$VERSION" "$REPO" "$INSTALL_DIR/repo" >/dev/null 2>&1
fi

# Build
cd "$INSTALL_DIR/repo"
npm install --silent
npm run build

# Symlink the CLI
ln -sf "$INSTALL_DIR/repo/dist/cli.js" "$BIN_DIR/iolit"
chmod +x "$BIN_DIR/iolit"

# Add to PATH
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) echo "export PATH=\"$BIN_DIR:\$PATH\"" >> "$HOME/.bashrc"
     echo "export PATH=\"$BIN_DIR:\$PATH\"" >> "$HOME/.zshrc" 2>/dev/null || true ;;
esac

echo ""
echo "Done. Run: iolit"
echo "See past batches: iolit history"
