# Tomorrowland W2 2026 Planner

Personal timetable planner for Tomorrowland Belgium 2026, Weekend 2 (Jul 24–26).
Offline-first PWA — static files, no build step, no dependencies.

- **Timetable** — full official set times for all 15 stages; tap a set to star it
- **My Timetable** — starred + custom entries per day, with clash warnings and a live "now" marker (Europe/Brussels)
- **Stages** — hide/reorder stages, per-stage accent colors, export/import backup

## Use on iPhone

1. Open the site in Safari (on Wi-Fi, before the festival)
2. Share → **Add to Home Screen**
3. Open it once fully — the service worker caches everything for offline use

## Development

Any static file server works, e.g. `node .claude/serve.cjs`, then open http://localhost:8347.

Data extracted from the official W2 2026 timetable (via timetable.lol) into [data.js](data.js).
