#!/bin/sh
# Once, after cloning: the engine and pocket-m5 (submodules), Bun 1.4.2 in vendor/bin, and their packages.
#   sh tools/setup.sh
set -eu
cd "$(dirname "$0")/.."
BUN_VERSION=1.4.2
git submodule update --init engine vendor/pocket-m5
git -C vendor/pocket-m5 submodule update --init third_party/pocketjs
if [ ! -x vendor/bin/bun ] || [ "$(vendor/bin/bun --version)" != "$BUN_VERSION" ]; then
  mkdir -p vendor/bin
  tmp=$(mktemp -d)
  curl -fsSL "https://github.com/oven-sh/bun/releases/download/bun-v$BUN_VERSION/bun-darwin-aarch64.zip" -o "$tmp/bun.zip"
  unzip -q "$tmp/bun.zip" -d "$tmp"
  mv "$tmp/bun-darwin-aarch64/bun" vendor/bin/bun
  rm -rf "$tmp"
fi
(cd engine && npm ci --silent)
(cd vendor/pocket-m5 && ../bin/bun install --frozen-lockfile)
(cd sidecar && ../vendor/bin/bun install --frozen-lockfile)
echo "ready: vendor/bin/bun tools/app.ts --run"
