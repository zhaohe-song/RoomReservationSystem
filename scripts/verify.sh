#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
dotnet run --project server/RoomReservation.Api.csproj --no-build --urls http://127.0.0.1:5080 > /tmp/room-reservation-api.log 2>&1 &
api_pid=$!
trap 'kill "$api_pid" 2>/dev/null || true' EXIT
for attempt in {1..50}; do
  if curl --silent --fail --noproxy '*' http://127.0.0.1:5080/api/bootstrap > /dev/null; then
    python3 scripts/smoke.py
    exit 0
  fi
  sleep 0.2
done
cat /tmp/room-reservation-api.log
exit 1
