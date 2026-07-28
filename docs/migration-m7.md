# M7 OpenSkillHub Legacy Migration And Cutover

The legacy root service (`../server.js` and `../public/`) is not a runtime dependency of this Node project. It remains only as a rollback reference until the production cutover is signed off.

## Capability Mapping

| Legacy capability | OpenSkillHub replacement | Migration decision |
| --- | --- | --- |
| Static `public/` dashboard | `frontend/` Skill deck, login, generated pages, and admin console | Replaced |
| `/oc/*` transparent OpenCode proxy | Provider lifecycle plus server-owned `/api/*` operations | Retired: browsers never receive an OpenCode endpoint |
| `/download?path=...` arbitrary file download | `/api/artifacts/:artifactId/download` | Replaced with owner-checked artifact IDs |
| `/artifacts?projectPath=...` arbitrary project scan | Run-scoped artifacts and `/runs` history | Replaced with run workspaces |
| `/upload` shared multipart folder | `/api/uploads` user-owned upload records staged per run | Replaced |
| `/frontend/` legacy card prototype | `/` in OpenSkillHub | Retired |

OpenSkillHub intentionally returns no legacy proxy, arbitrary-path download, project scanning, or shared upload endpoint. This is a security boundary, not a compatibility gap.

## Canary Verification

1. Keep the legacy process on `5177` untouched.
2. Run OpenSkillHub on a separate canary port, for example `5180`: `$env:HUB_PORT=5180; npm.cmd run dev` in PowerShell.
3. Sign in at `/login`, test a generated page and its fallback page, upload a file, run a Skill, and download an artifact.
4. Verify a second user receives `404` for the first user's run and artifact URLs.
5. Verify `/api/health` returns `service: "open-skill-hub"`, and that `/oc/session`, `/download`, `/artifacts`, and `/upload` are unavailable.

## Production Cutover

Run `scripts/cutover-legacy-service.ps1` from an elevated PowerShell after the canary has passed. It defaults to a dry run. Its apply mode requires the explicit legacy PID and verifies that PID is a `server.js` process before stopping it. It then starts the installed `OpenSkillHub` service and validates the new health response on the production port.

The script does not delete `../server.js`, `../public/`, the legacy logs, or any legacy upload data. Keep them through the agreed rollback period. If the new service health check fails, use the recorded legacy start command to restart the old process and investigate before retrying.

## Completion Evidence

M7 is ready for a maintenance-window cutover when the automated migration, legacy retirement, and performance checks pass. Actual legacy shutdown must be recorded with the deployed PID, timestamp, administrator, and a successful post-switch `/api/health` response. A real LAN device verification remains part of Stage 11 final acceptance.
