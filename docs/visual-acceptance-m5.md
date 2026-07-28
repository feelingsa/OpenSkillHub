# M5 OpenSkillHub Desktop Visual Acceptance

## Evidence

- Design source: `source/Skill Web Hub — 管理端.svg`.
- Capture: `docs/baselines/admin-m5-desktop-1440x900.png`.
- Metrics: `docs/baselines/admin-m5-desktop-1440x900.json`.
- Repeatable command: `npm.cmd run build; npm.cmd run capture:admin`.

The capture starts an isolated local Hub instance with a temporary SQLite database and a visual-only administrator. It does not read the real `.env` credentials. It signs in, captures `/admin` at exactly `1440 x 900`, requires seven sidebar routes, four overview metrics, at least one audit row, and rejects horizontal overflow or browser console errors.

## Compared Shell

The M5 shell retains the management design source's dark desktop canvas, fixed left navigation, compact mono brand treatment, accent selection rail, content header, and restrained bordered data surfaces. The SPA routes use the same sidebar and top-level workspace frame. Tables, filter toolbar, detail drawer, confirmation flow, loading, empty, API error, provider offline, and unauthenticated states are code-owned product supplements.

## Registered Differences

- The source export contains static example content across a tall design canvas. The implementation uses live scanner, page queue, run, storage, and provider data; counts, labels, timestamps, and availability consequently vary by host.
- The source does not define a bootstrap-password login, diagnostics download, storage-retention confirmation, backup behavior, generated-page event logs, audit history, or failure state. Those additions follow `ui-state-contract.md` and are not raster-only comparison targets.
- Mobile layouts are deliberately out of scope. The evidence and acceptance command use only the registered `1440 x 900` desktop viewport.

## Result

Captured on 2026-07-25 at `1440 x 900`: document width `1440`, seven sidebar routes, four overview metric cards, an authenticated audit row, authenticated `/admin` route, and no browser errors. The management shell is readable at the approved desktop baseline and has no horizontal overflow.
