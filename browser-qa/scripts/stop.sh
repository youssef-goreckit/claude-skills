#!/bin/sh
# usage: stop.sh <port> — stops the app, Chrome and driver that start.sh <port> launched.
P=$1; Q=/tmp/browser-qa-$P
[ -n "$P" ] || { echo "usage: stop.sh <port>"; exit 1; }
pkill -f "user-data-dir=$Q/chrome-profile"
for p in $P $((P+2)); do lsof -tnP -iTCP:$p -sTCP:LISTEN | xargs kill 2>/dev/null; done
sleep 1; lsof -nP -iTCP:$P,$((P+1)),$((P+2)) -sTCP:LISTEN || echo stopped
