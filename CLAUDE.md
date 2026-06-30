# Render on Demand (`render-on-demand`)

A FoundryVTT v13 module (settings + lifecycle hooks), built with Vite + TypeScript. See ADR-0001 for the toolchain.

## Layout

| Path | Role |
|------|------|
| `module.json` | The manifest. `id` = `render-on-demand` and MUST match the install folder + zip name. release-please bumps `$.version` in lockstep with `package.json`. |
| `src/module.ts` | ESM entry (`esmodules`). Registers hooks; built to `dist/render-on-demand.mjs` by Vite. |
| `src/settings.ts` | `game.settings` registration (called from `init`). |
| `src/constants.ts` | `MODULE_ID` / `MODULE_TITLE` — the single source for the id. |
| `src/foundry-shims.d.ts` | Loose ambient types for the Foundry globals. Keep `tsc` green; verify the real API before trusting a shape. |
| `lang/en.json` | Localization. Keys are namespaced under `render-on-demand.`. |
| `styles/render-on-demand.css` | Styles, every selector scoped under `.render-on-demand*`. |

## Rules of the road

- **Target the harness-pinned Foundry version.** The local `foundryvtt-harness`
  pins a specific build; module behavior is version-specific. `module.json`
  `compatibility.{minimum,verified}` is the manifest source of truth — keep it in
  sync with what you actually test against, and bump the pin and the code
  together.
- **Verify the Foundry API before patching.** `game.*`, document classes, hooks,
  and the `foundry.applications.*` namespaces change across major versions.
  Check <https://foundryvtt.com/api/> or the live console — not memory.
- **ESM only, paths must byte-match the manifest.** `esmodules` references
  `render-on-demand.mjs`; if the Vite output name drifts, the module silently fails
  to load.
- **Do not commit `dist/`.** It is a build artifact (git-ignored); CI builds it
  for releases.
- **`just check` is the gate.** Typecheck + build + lint + test must pass before
  pushing.

## Hooks

`init` registers settings (and patches); `ready` runs once
`game.*` is populated. Settings are only readable from `setup` onward.
