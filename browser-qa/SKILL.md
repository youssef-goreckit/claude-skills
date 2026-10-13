---
name: browser-qa
description: Test a feature of the agent or traveller web app in a real Chrome — click, type, find widgets by text, read console and failed network logs, take screenshots and screen-record to mp4. Each run gets its own app, Chrome and ports, so parallel agents never collide. Use when asked to test, QA, verify, reproduce, screenshot, or record something in the browser / on web.
---

# Browser QA

Scripts live in `.claude/skills/browser-qa/scripts/`. Needs Google Chrome, node 22+, ffmpeg and fvm.

## Start

Pick a free base port (each run uses `P`, `P+1`, `P+2`; use a different `P` per agent):

```shell
S=.claude/skills/browser-qa/scripts
$S/start.sh apps/reckit_plus_agent 3050             # builds lib/dev.dart, serves :3050
$S/start.sh apps/reckit_plus_traveller 3060 -t lib/staging.dart
$S/start.sh http://localhost:8080/ 3070             # an app that is already running
```

It opens a visible Chrome with its own profile (`/tmp/browser-qa-P/`), never the user's Chrome. Build log: `/tmp/browser-qa-P/flutter.log`. Stop with `$S/stop.sh P` when done.

## Drive

`$S/b.sh P <command> key=value ...` — every command prints JSON.

| Command | Example |
|---|---|
| `find` | `find text=Continue` → `[{"label":"Continue","x":349,"y":656}]` |
| `click` / `hover` | `click x=349 y=656` |
| `type` / `key` | `type text=qa@example.com`, `key key=Enter` (Tab, Escape, Backspace, arrows) |
| `scroll` | `scroll x=700 y=500 dy=600` |
| `nav` / `reload` | `nav url=http://localhost:3050/#/bookings` |
| `viewport` | `viewport width=390 height=844 mobile=true scale=3` |
| `shot` / `fullshot` | `shot path=/tmp/qa/01-login.png` |
| `recstart` / `recstop` | `recstart`, then `recstop out=/tmp/qa/flow.mp4` |
| `logs` | `logs n=30 grep=Exception` (console, exceptions, HTTP 4xx/5xx) |
| `eval` | `eval expr='location.href'` |
| `tabs` | open page URLs |

Flutter draws to a canvas, so use `find` to get coordinates: it turns on Flutter's semantics tree and returns the innermost nodes whose label contains the text (case-insensitive). Click the returned `x`/`y`. Coordinates are CSS pixels; screenshots are device pixels (twice as large on retina).

## Work loop

1. `find`, then `click`/`type`, then `shot` and look at the image. Never claim a screen state you did not see in a screenshot.
2. Wait for the app after navigation: Flutter needs a second or two to repaint; re-`find` or re-`shot` instead of guessing.
3. Check `logs grep=EXCEPTION` and `logs grep=HTTP` before calling a flow passed.
4. To record, `recstart` before the first action and `recstop` after the last. Frames only arrive when the page repaints, so idle time is kept at real speed.
5. Hand screenshots and recordings to the `attach-github-media` skill to put them on a PR.

## Gotchas

- `port P busy`: another agent owns it. Pick another `P`; don't kill their stack.
- Use `localhost`, not `127.0.0.1`: tenant lookup goes through `domains.json` by host.
- Hot restart isn't wired. After code changes, `stop.sh` and `start.sh` again.
