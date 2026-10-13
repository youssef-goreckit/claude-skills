#!/bin/sh
# usage: b.sh <port> <cmd> [k=v ...]   e.g. b.sh 3050 click x=812 y=664
P=$1; cmd=$2; shift 2
q=""
for kv in "$@"; do
  q="$q&${kv%%=*}=$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1]))' "${kv#*=}")"
done
curl -s "http://localhost:$((P+2))/$cmd?${q#&}"
