#!/bin/zsh
# Runs the built app against a scratch home and waits for the sidecar. For development.
#   tools/dev.sh [home]        (default /tmp/pb-home)
HOME_DIR=${1:-/tmp/pb-home}
ROOT=${0:A:h:h}
# (Only this home's sidecar: other people run their own.)
pkill -f "MacOS/pocket-bench" 2>/dev/null
[[ -f $HOME_DIR/.bench/server.json ]] && kill $(python3 -I -c "import json;print(json.load(open('$HOME_DIR/.bench/server.json'))['pid'])") 2>/dev/null
sleep 0.6
rm -f $HOME_DIR/.bench/server.json
open -n --env POCKET_BENCH_HOME=$HOME_DIR --stderr /tmp/pb-app.err --stdout /tmp/pb-app.out "$ROOT/.build/xcode/Build/Products/Release/Pocket Bench.app"
for i in {1..80}; do [[ -f $HOME_DIR/.bench/server.json ]] && break; sleep 0.25; done
python3 -I -c "import json;print(json.load(open('$HOME_DIR/.bench/server.json'))['port'])"
