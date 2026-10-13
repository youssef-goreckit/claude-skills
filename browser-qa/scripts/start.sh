#!/bin/sh
# usage: start.sh <app-dir|url> <port> [flutter run args...]
# Own stack per run: app on <port> (app-dir mode), Chrome CDP on <port>+1, driver on <port>+2.
# Work dir /tmp/browser-qa-<port> holds the Chrome profile and logs. Stop with stop.sh <port>.
set -e
TARGET=$1; P=$2; shift 2
[ -n "$TARGET" ] && [ -n "$P" ] || { echo "usage: start.sh <app-dir|url> <port> [flutter args]"; exit 1; }
S=$(cd "$(dirname "$0")" && pwd); Q=/tmp/browser-qa-$P
for p in $P $((P+1)) $((P+2)); do
  lsof -nP -iTCP:$p -sTCP:LISTEN >/dev/null && { echo "port $p busy, pick another port"; exit 1; }
done
mkdir -p $Q
case $TARGET in
  http*) URL=$TARGET ;;
  *)
    URL=http://localhost:$P/
    [ $# -gt 0 ] || set -- -t lib/dev.dart
    (cd "$TARGET" && fvm flutter run -d web-server --web-port $P --web-hostname localhost "$@" > $Q/flutter.log 2>&1 &)
    echo "building $TARGET (log $Q/flutter.log)"
    until grep -q "is being served" $Q/flutter.log 2>/dev/null; do
      grep -qiE "^Error|failed to compile" $Q/flutter.log 2>/dev/null && { tail -20 $Q/flutter.log; exit 1; }
      sleep 3
    done ;;
esac
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --user-data-dir=$Q/chrome-profile \
  --remote-debugging-port=$((P+1)) --no-first-run --no-default-browser-check --window-size=1500,1000 \
  "$URL" > $Q/chrome.log 2>&1 &
until curl -s localhost:$((P+1))/json/version >/dev/null; do sleep 1; done
CDP_PORT=$((P+1)) DRIVER_PORT=$((P+2)) APP_URL=$URL node $S/driver.mjs > $Q/driver.log 2>&1 &
until curl -s localhost:$((P+2))/tabs >/dev/null 2>&1; do sleep 1; done
echo "ready: $URL  (drive with: $S/b.sh $P <cmd> k=v ...)"
