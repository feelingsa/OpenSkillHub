# M2 Desktop Visual Acceptance

## Evidence

- Design source: `source/Skill Web Hub — 用户端.svg`.
- Current capture: `docs/baselines/home-current-desktop-1440x900.png`.
- Capture metrics: `docs/baselines/home-current-desktop-1440x900.json`.
- Repeatable Windows PowerShell command:

```powershell
$env:HUB_VISUAL_URL = "http://127.0.0.1:5181/"
npm.cmd run capture:desktop
```

The capture runs the current Node service in local Microsoft Edge at exactly `1440 x 900`. It requires one visible focused card, rejects horizontal overflow, and fails on page or console errors.

## Compared Shell

The user SVG's embedded desktop reference establishes the dark grid canvas, compact provider label, large `SKILL WEB HUB` title, centered perspective stack, and a single full-width focus card. The current desktop capture preserves these shell signals and uses the extracted design color tokens. The card deck, hover lift, wheel/keyboard stack movement, modal interaction, and reduced-motion behavior remain code-owned rather than being rasterized from the design source.

## Registered Differences

- The source image contains a fixed six-Skill sample deck. The current capture uses the actual scanned catalog, so card count, card order, previews, labels, page states, and availability status are live data.
- Search and page-state filtering are a required catalog operation for the scanned global Skill set. They are product-supplement controls above the deck and do not replace the source-defined card interaction.
- The connection badge reports the real OpenCode health state. Its text and tone therefore vary between captures.
- The design source does not define loading, empty, scan-error, offline, or generated-page states. Those states follow `ui-state-contract.md` and are outside the raster-only comparison area.

## Result

Captured on 2026-07-24: `1440 x 900`, document width `1440`, dynamic card count `66`, focused card count `1`. The desktop shell has no horizontal overflow and the rendered catalog preserves the approved card-deck interaction model.
