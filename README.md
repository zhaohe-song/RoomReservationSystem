# Spaces — Room Reservation System

A small, locally runnable room reservation demo for the TIU 11 Applications Developer coding challenge. Staff can find rooms across sites, request a time slot, and see upcoming reservations. An admin persona can approve or deny requests and manage the room directory.

## Run locally (Mac / VS Code)

Install the [.NET 10 SDK](https://dotnet.microsoft.com/download/dotnet/10.0) and [Node.js 22 or later](https://nodejs.org/). Open this folder in VS Code, then use two terminals:

**Mac compatibility:** Microsoft currently supports .NET 10 on macOS 14 or newer. The author's Intel Mac with macOS 12.7.6 aborts during `dotnet restore`. A separate [`monterey-net8` branch](https://github.com/zhaohe-song/RoomReservationSystem/tree/monterey-net8) keeps the same app and uses .NET 8 as a best-effort local demo fallback. It is validated in Linux but still needs testing on the actual Mac; macOS 12 itself is no longer in Microsoft's support list.

**Terminal 1 — API**

```bash
cd server
dotnet restore
dotnet run --urls http://127.0.0.1:5080
```

**Terminal 2 — React app**

```bash
cd client
npm ci
npm run dev
```

Open <http://127.0.0.1:5173>. Vite forwards `/api` calls to the local API. No cloud database or account is needed. The API creates `server/Data/reservations.db` and seeds three sites, five rooms, and three demo users on first launch. The database file is ignored by Git. To reset the demo, stop the API and delete `server/Data/reservations.db` (and any `-wal` / `-shm` companions), then restart.

Use the user menu in the upper right to switch between **Alex Morgan / Taylor Chen (Staff)** and **Jordan Lee (Admin)**. For a quick walkthrough: select a future date and available room, request a booking as Alex, switch to Jordan and approve it, then switch back to Alex to see the status. Try the same room with an overlapping time to see the conflict response.

## Scope and decisions

| Area | Shipped in this slice | Reason / tradeoff |
| --- | --- | --- |
| Data | SQLite file with EF Core models for `Site`, `Room`, `User`, `Reservation` | Familiar SQL model with no separate server or credentials; local reset is easy. |
| Search | Site, capacity, date and time filters; unavailable rooms shown distinctly | Staff can see why a room cannot be requested. |
| Requests | Future time range, title, owner and pending status | Half-open ranges (`start < otherEnd && otherStart < end`) let adjacent meetings touch. |
| Decisions | Pending → approved or denied; a denied request frees its slot | Pending requests temporarily hold their time; this prevents multiple applicants for the same slot. |
| Conflict safety | Server checks overlap inside a SQLite write transaction | UI availability is advisory; the server checks again at submission. SQLite serializes concurrent local writers. |
| Admin directory | Add sites/rooms, activate/deactivate rooms | Existing reservations remain visible if a room is deactivated. |

**Cut for this exercise:** Authentication and authorization, recurring meetings, editing/cancelling reservations, notifications, calendars, time zone selection, pagination, database migrations and deployment. The user menu is only a **demo persona switcher**, not secure identity. API calls for directory management are not access controlled. Run this app locally as a demo; authentication and role checks must come before any shared deployment. The browser sends local time converted to UTC and the database stores UTC, so people in different browser time zones will see each event in their own local time.

`EnsureCreated()` makes first-run setup simple, but does not support evolving schemas. With more time, I would add EF migrations, real sign-in and server-enforced authorization, cancellation and editing with conflict rechecks, admin review history, tests for simultaneous requests, and an accessible calendar view. For production on multiple API instances, I would move reservations to a shared database and design an explicit transaction/locking strategy there.

## Estimate vs. actual work

This is an AI-assisted implementation pass, **not a claim that all work was done manually within a three-hour timed session**. Estimates are the priorities I would set at the start of a three-hour challenge; actuals reflect this pass and should be updated after local Mac verification and presentation rehearsal.

| Work | Planned budget | Actual in this pass |
| --- | ---: | --- |
| Scope, model and project setup | 20 min | Not timed separately |
| API, persistence and conflict rules | 65 min | Not timed separately |
| React interface and core flows | 60 min | Not timed separately |
| Verification, README and demo prep | 35 min | Not timed separately |
| **Total** | **180 min** | **~15 min for initial build and checks (14:29–14:44 UTC); GitHub delivery tracked separately** |

The actual elapsed time above is a wall-clock estimate for this AI-assisted session. Individual phases were not separately timed. This is not a substitute for running the project on the presentation machine.

## Verification

From the repo root, with the API running at port 5080:

```bash
python3 scripts/smoke.py
```

The smoke script creates a test room and checks pending conflicts, adjacent slots, denial releasing a slot, approved conflicts, and listing. It leaves its test records in the demo database. The frontend build is `cd client && npm run build`.

**Current validation:** React TypeScript build and .NET 10 backend build passed. The smoke script passed against a running API, including two simultaneous requests for one slot. A local Mac walkthrough and visual browser check are still recommended before the interview.

## AI usage log

| Tool / output | Decision and intervention |
| --- | --- |
| ChatGPT / Codex generated the initial ASP.NET Core API, EF models, React UI, CSS, and documentation | Accepted the stack chosen for the exercise; reviewed and modified the generated flow and validation. |
| Initial backend draft represented demo users only in a fixed array | **Modified** to seed a real `User` table because user modeling is part of the brief. The demo persona menu still has no authentication. |
| Initial UI cleared form fields even when the API call failed and could default to a past time late in the day | **Rejected/modified** those behaviors: fields clear only on success, and late-day startup defaults to the next morning. |
| Conflict logic and timestamps | **Reviewed** half-open interval comparison, pending holds, denial release, and transaction boundary. Added an API smoke walkthrough including two simultaneous requests. **Modified** SQLite-loaded timestamps to serialize with `Z` so browsers display the correct local time. Broader load testing remains future work. |
| Dependency review | The first EF Core package version pulled in an older SQLite native package with a security advisory. **Modified** the package reference to a newer .NET 10 patch; restore/build then completed without warnings. |
| Local Mac compatibility | The chosen .NET 10 stack failed during restore on macOS 12.7.6. **Intervened** by preserving this branch and adding a separate .NET 8 demo branch, with the unsupported-OS limitation documented. |
| Official .NET / Vite documentation | Used to check current minimal API, SQLite provider and React TypeScript tooling conventions. |

I chose a local database rather than a hosted service because the interview demo must work from VS Code and Terminal without account setup or network access.

## 10–15 minute presentation outline

1. **1–2 min:** Explain the brief, three-hour budget and why the core booking slice came first.
2. **3 min:** Show the model: sites → rooms → reservations → users; pending/approved/denied.
3. **4 min:** Request a room as staff, review it as admin, and show it in upcoming reservations.
4. **2 min:** Demonstrate overlapping rejection and adjacent time slots; point to the server transaction.
5. **2 min:** Discuss what AI produced, what I corrected, the omitted security, and the next steps.
