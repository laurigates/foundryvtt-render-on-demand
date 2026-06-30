# Render on Demand

Skip the main-screen render when nothing visual changed — a render-on-demand idle
optimization for [FoundryVTT](https://foundryvtt.com/) v13 (verified on v13.348).

> ⚠️ **Experimental prototype.** The mechanism is proven and measured in a
> controlled harness (see below), but it has **not yet been exhaustively tested
> in real-world play** across many systems, modules, and scene types. A
> render-gate must catch *every* source of visual change or the canvas can appear
> frozen until you next interact. Try it in a non-critical world first, and please
> [report](https://github.com/laurigates/foundryvtt-render-on-demand/issues) any
> subsystem that freezes. See **Limitations & risk** below.

## What

Foundry's canvas renderer (PIXI) redraws the **entire stage every frame**,
unconditionally, whether or not anything changed. This module gates that draw on a
*needs-render* latch: at idle the screen render is skipped; the instant anything
changes (a token moves, a light animates, you hover/drag/pan, a video plays,
weather falls) rendering resumes immediately.

It changes **how often** the GPU draws, not **what** it draws.

## Why

Profiling a busy scene (79 tokens, 141 light sources, 1027 walls) at **idle, zero
interaction** found Foundry's JavaScript ~97% idle, yet the renderer still issued
**~117–232 WebGL draw calls every frame** re-drawing a completely static scene.

**Root cause (source-confirmed, `client/canvas/board.mjs`):**

- `#applyRenderFlags(queue)` early-outs on an empty queue — Foundry's per-frame
  *logic* is correctly dirty-gated, which is why JS is ~97% idle.
- `new PIXI.Application({view, ...})` relies on PIXI's default `autoStart: true`,
  which registers `renderer.render(stage)` on the ticker and calls it
  **unconditionally every frame**. There is no frame-level "skip the draw when
  nothing changed."

So Foundry skips idle *logic* but PIXI still re-draws the whole stage every frame —
continuous GPU/CPU work (fans/battery/heat) while nothing happens.

## How

- **Wrap the instance method `canvas.app.renderer.render`.** For the *main-stage*
  pass only (`displayObject === canvas.stage && !options.renderTexture` — never
  off-screen render-texture passes), skip the draw when no render was requested
  recently **and** `continuousActive()` is false.
- **A HIGH-priority ticker latch** samples `canvas.pendingRenderFlags` (`OBJECTS` +
  `PERCEPTION` queues) *before* Foundry's own callbacks clear them. Any pending
  flag → request a render. This catches every change that flows through Foundry's
  render-flag system.
- **Pointer/wheel listeners** on the canvas element + a broad set of `refresh*` /
  `draw*` / camera hooks request renders for interaction and discrete refreshes.
- **`settleFrames`** (default 3) renders a few extra frames after each dirty signal
  — a conservative correctness margin so a single missed signal degrades to
  "rendered a few extra frames", not "frozen canvas".

`continuousActive()` is the safety predicate — it returns true (keep rendering) for
any legitimate ongoing motion that does **not** go through the render-flag system:
active `CanvasAnimation`s (movement, fades, pings, ring pulses, darkness
transitions), playing video meshes, **genuinely** animated light/vision sources
(checks each source's `animation.type` — *not* the always-on `animateLightSources`
boolean, which would defeat the gate), weather particle systems, and live animated
filters (outside photosensitive mode).

No `libWrapper` dependency — a plain instance wrap + ticker latch + hooks keeps the
moving parts minimal.

## Measured results

A/B measured in an automated harness (the gate injected into the live page,
non-destructive), Waterdeep scene Level3-A (79 tokens, 141 light sources, 0
animated lights, 1027 walls), 15s idle window per phase.

**Real GPU — Apple M4 Pro (ANGLE Metal), 120Hz display:**

| Metric (idle) | Gate OFF (baseline) | Gate ON |
|---|---|---|
| main-stage renders/sec | 58.4 | **0.0** |
| WebGL draw calls/frame | 117 | **0** |
| scripting ms/sec | 119.5 | **13.0** |
| main-thread busy % | 17.7 | **7.8** |
| rAF FPS (display refresh) | 120.0 | 119.9 |
| idle frames skipped (15s) | 0 | **923 / 923** |

On real hardware the idle render path burns ~119 ms/s of scripting and **17.7% of
one core** re-drawing a static scene; the gate cuts that to 13 ms/s and **7.8%**
(~90% less render scripting, main-thread busy more than halved). The display-refresh
fps is unchanged (the page keeps presenting); the win is in the work *avoided* per
idle frame.

A synthetic `pointermove` woke the gate for exactly `settleFrames`(=3) frames, then
it returned to skipping — interaction resumes rendering immediately.

**Correctness** (automated, non-destructive, 5/5): idle skips · render-flag latch
wakes · CanvasAnimation pan renders every frame (0 skipped = no freeze) · pointer
hover wakes · returns to idle skipping after motion.

> These are controlled-harness numbers under software/headless GL and one real
> Apple GPU. They are **not** a guarantee for your hardware, modules, or play
> style — see the caveat at the top.

## Relationship to Prime Performance (`fvtt-perf-optim`)

**Orthogonal and multiplicative.** Prime Performance makes each *frame* cheaper
(draw-call batching); Render on Demand removes the *frames* themselves when nothing
changed. Fewer frames × cheaper frames stack. Prime Performance does not skip idle
frames, and core Foundry has no idle/blur render gate.

## Limitations & risk

- **Must catch every dirty source.** If a change neither sets a render flag, nor
  fires a covered hook, nor registers as `continuousActive()`, the canvas can
  appear frozen until the next interaction. `settleFrames` makes a *single* miss a
  cosmetic stutter rather than a freeze; a *systematic* miss for some subsystem is a
  real bug — please report it.
- The video / weather / animated-filter branches of `continuousActive()` are coded
  conservatively but have not yet been exercised against a wide range of real
  scenes. Verify in a scene that uses them before relying on the gate there.
- Not yet tested across the full breadth of game systems and modules. Treat as a
  prototype.

## Settings

- **Enable Render on Demand** (`enabled`, default on)
- **Settle frames** (`settleFrames`, default 3)
- **Debug logging** (`debug`, default off)

Runtime A/B without touching settings — the gate reads `window.__rod`:

```js
window.__rod.enabled = false   // off (always render)
window.__rod.enabled = true    // on  (gate)
window.__rod.stats             // { skipped, rendered, requests }
```

## Install

In Foundry, **Add-on Modules → Install Module → Manifest URL**, paste:

```
https://github.com/laurigates/foundryvtt-render-on-demand/releases/latest/download/module.json
```

## Development

Requires [bun](https://bun.sh/). Any local Foundry on `:30000` is the run/test
environment.

```
bun install
just check        # typecheck + build + lint + test (the CI gate)
just dev          # Vite dev server with HMR, proxying to Foundry on :30000
```

To run inside Foundry, build and symlink `dist/` into your Foundry data:

```
just build
ln -s "$(pwd)/dist" "<FoundryData>/Data/modules/render-on-demand"
```

(`dist/` is git-ignored and rebuilt; the manifest, lang, and styles are copied into
it by the build.)

## Releasing

Conventional-commit `feat:` / `fix:` commits drive
[release-please](https://github.com/googleapis/release-please): merging its release
PR tags a version, bumps `package.json` **and** `module.json`, builds the module,
zips `dist/`, and attaches `render-on-demand.zip` + `module.json` to the GitHub
release — which is what the manifest URL above resolves to.

## License

MIT — see [LICENSE](LICENSE).
