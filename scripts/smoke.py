"""Small API walkthrough: run the server first, then `python3 scripts/smoke.py`."""

import json
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

BASE = "http://127.0.0.1:5080/api"


def request(path, method="GET", payload=None):
    data = None if payload is None else json.dumps(payload).encode()
    req = urllib.request.Request(
        BASE + path,
        data=data,
        method=method,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        return error.code, json.load(error)


def expect(actual, wanted):
    assert actual == wanted, f"Expected {wanted}, got {actual}"


now = datetime.now(timezone.utc) + timedelta(days=14)
start = now.replace(hour=12, minute=0, second=0, microsecond=0)
end = start + timedelta(hours=1)
site_id = request("/bootstrap")[1]["sites"][0]["id"]
status, room = request("/rooms", "POST", {
    "siteId": site_id, "name": "Smoke test room " + start.isoformat(),
    "capacity": 4, "features": "Test only",
})
expect(status, 201)
room_id = room["id"]


def reserve(a, b):
    return request("/reservations", "POST", {
        "roomId": room_id, "userId": 1, "title": "Smoke test",
        "start": a.isoformat(), "end": b.isoformat(),
    })


status, first = reserve(start, end)
expect(status, 201)
expect(first["status"], "Pending")
expect(reserve(start + timedelta(minutes=30), end + timedelta(minutes=30))[0], 409)
expect(reserve(end, end + timedelta(hours=1))[0], 201)  # Adjacent slots do not overlap.
status, _ = request(f"/reservations/{first['id']}/decision", "PATCH", {
    "adminUserId": 3, "status": "Denied",
})
expect(status, 200)
status, second = reserve(start, end)
expect(status, 201)  # Denial releases the slot.
expect(request(f"/reservations/{second['id']}/decision", "PATCH", {
    "adminUserId": 3, "status": "Approved",
})[0], 200)
expect(reserve(start, end)[0], 409)
expect(request("/reservations?userId=1&upcoming=true")[0], 200)

parallel_start = start + timedelta(hours=3)
with ThreadPoolExecutor(max_workers=2) as pool:
    outcomes = list(pool.map(lambda _: reserve(parallel_start, parallel_start + timedelta(hours=1)), range(2)))
expect(sorted(code for code, _ in outcomes), [201, 409])
print("PASS: pending conflict, adjacent slot, denial release, approval conflict, concurrent requests, listing")
