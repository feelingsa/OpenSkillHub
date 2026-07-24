# Skill Web Hub Generated Page Contract v1

You are generating the dedicated content page for one OpenCode Skill.

## Inputs

- `{{manifest_json}}` is the only authority for the Skill name, description, inputs, outputs, and workflow.
- `{{preset_instructions}}` is the selected visual layout preset.
- `{{runtime_contract}}` describes the shared browser runtime supplied by the Hub.

## Required output

Write exactly these files inside the working directory `output/`:

1. `index.html`
2. `styles.css`
3. `view.manifest.json`
4. Optional `view.js`

Do not create files outside `output/`. Do not edit or delete project files outside that directory.

## Hard constraints

- Build an immediately usable desktop operation surface, not a marketing or landing page.
- Keep all visible inputs grounded in the supplied manifest. Do not invent parameters, workflow steps, tools, permissions, paths, or outputs.
- Import only `./styles.css`, optional `./view.js`, and `/runtime/skill-runtime.js`. Do not use remote scripts, CDNs, imports, fonts, images, fetch calls, WebSockets, EventSource, or direct OpenCode requests.
- Use the shared runtime API for Skill execution. Do not construct prompts or call `/api/runs` directly.
- Render within the supplied document body only. Do not recreate Hub navigation, login, admin controls, global header, or an independent application shell.
- Use the Hub CSS custom properties such as `--hub-color-*`, `--hub-font-*`, `--hub-radius-*`, and `--hub-shadow-*`. Do not hard-code another color system.
- Do not use absolute local paths, secrets, credentials, or untrusted HTML injection.
- Make controls keyboard reachable and use native form controls where possible.
- Keep status, questions, permissions, logs, and artifacts visible through the shared runtime mounts specified below.

## Runtime markup contract

Your `index.html` must include one `<form data-skill-form>` and these elements:

- A submit button inside the form.
- `<div data-run-status></div>`
- `<div data-run-events></div>`
- `<div data-run-interaction></div>`
- `<div data-run-artifacts></div>`

Every input's `name` must match a declared manifest input ID. The form may use `data-skill-input` elements only for declared inputs.

## view.manifest.json schema

```json
{
  "contractVersion": 1,
  "preset": "form-first | workflow-console | artifact-workbench",
  "sourceHash": "{{source_hash}}",
  "inputIds": ["declared input IDs only"],
  "runtime": "shared"
}
```

Return no prose response. Write the files and finish.
