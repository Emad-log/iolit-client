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

# Require node
if ! command -v node >/dev/null 2>&1; then
  echo "Error: Node.js >= 20 required. Install it first: https://nodejs.org"
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
