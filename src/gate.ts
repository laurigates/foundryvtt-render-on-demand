// The render gate — skip the main-screen WebGL render when nothing changed.
//
// Background: Foundry's per-frame *logic* is dirty-gated (board.mjs
// `#applyRenderFlags` early-outs on an empty queue), but the GPU *draw* is not.
// `new PIXI.Application(...)` uses PIXI's default `autoStart`, which adds
// `renderer.render(stage)` to the ticker and calls it unconditionally every
// frame — re-drawing a completely static scene ~60x/sec.
//
// Mechanism: wrap the *instance* method `canvas.app.renderer.render`; for the
// main-stage pass only, skip the draw when no render was requested recently AND
// no continuous-render subsystem is active. A HIGH-priority ticker latch samples
// `canvas.pendingRenderFlags` before Foundry's callbacks clear them; pointer/
// wheel listeners + refresh hooks cover interaction. No libWrapper dependency.

import { MODULE_TITLE } from './constants';

interface RodController {
  enabled: boolean;
  settleFrames: number;
  debug: boolean;
  frameCountdown: number;
  installed: boolean;
  stats: { skipped: number; rendered: number; requests: number };
  requestRender(frames?: number): void;
  // populated by installGate, used by uninstallGate
  _latch?: ((...args: unknown[]) => void) | null;
  _view?: (EventTarget & { removeEventListener?: unknown }) | null;
  _onInteract?: (() => void) | null;
}

/** Single source of runtime state, exposed on `window.__rod` for console A/B. */
export const rod: RodController = {
  enabled: true, // overwritten from the setting at canvasReady
  settleFrames: 3,
  debug: false,
  frameCountdown: 0,
  installed: false, // guards against double-install across canvasReady re-fires
  stats: { skipped: 0, rendered: 0, requests: 0 },

  /** Request that the next `frames` main-stage renders proceed. */
  requestRender(frames?: number): void {
    const f = frames ?? rod.settleFrames;
    rod.frameCountdown = Math.max(rod.frameCountdown, f);
    rod.stats.requests++;
  },
};

/**
 * MUST return true for any legitimate ongoing motion, or that subsystem freezes.
 * Conservative: render when unsure.
 */
export function continuousActive(): boolean {
  try {
    const c = canvas;
    if (!c?.ready) return true;

    // 1. Any active CanvasAnimation: token/movement, fades, pings, ring pulses,
    //    darkness transitions, chat-bubble fades. The single broadest signal.
    const CanvasAnimation = foundry?.canvas?.animation?.CanvasAnimation;
    if (CanvasAnimation?.animations && Object.keys(CanvasAnimation.animations).length > 0) {
      return true;
    }

    // 2. A playing (un-paused) video mesh — texture updates every frame.
    const vids = c.primary?.videoMeshes;
    if (vids?.size) {
      for (const m of vids) {
        if (m?.sourceElement && m.sourceElement.paused === false) return true;
      }
    }

    // 3. Genuinely animated light/vision sources. NOTE: `animateLightSources` /
    //    `animateVisionSources` are always-on booleans (true by default), so we
    //    must check for a real per-source `animation.type`, not the flag — else
    //    the gate would never fire on a static scene.
    const fx = c.effects;
    if (fx) {
      if (fx.animateLightSources && typeof fx.allSources === 'function') {
        for (const s of fx.allSources()) {
          if (s?.active && s.animation?.type) return true;
        }
      }
      if (fx.animateVisionSources && fx.visionSources?.size) {
        for (const s of fx.visionSources.values()) {
          if (s?.active && s.animation?.type) return true;
        }
      }
    }

    // 4. Weather effects present (rain/snow/fog particle systems self-animate).
    const we = c.weather?.weatherEffects;
    if (we?.children?.length > 0) return true;

    // 5. A live animated filter anywhere on the main display tree (glow/outline
    //    pulses). Skipped under photosensitive mode (those animations are off).
    if (!c.photosensitiveMode && anyAnimatedFilter(c.stage)) return true;

    return false;
  } catch (_e) {
    return true; // on any error, fail safe → render
  }
}

/** Shallow-ish scan for an attached filter flagged `.animated === true`. */
function anyAnimatedFilter(root: any, depth = 0): boolean {
  if (!root || depth > 4) return false;
  const filters = root.filters;
  if (filters?.length) {
    for (const f of filters) if (f?.animated === true) return true;
  }
  const children = root.children;
  if (children?.length) {
    for (const ch of children) if (anyAnimatedFilter(ch, depth + 1)) return true;
  }
  return false;
}

/** Wrap the instance method renderer.render with the gate. Idempotent. */
export function installGate(): void {
  if (rod.installed) return;
  const renderer = canvas?.app?.renderer;
  if (!renderer) return;

  const original = renderer.render.bind(renderer);

  const gated = function (this: unknown, displayObject: unknown, options?: any) {
    const isMainPass =
      (window as any).__rod?.enabled &&
      displayObject === canvas.stage && // main screen pass only
      !options?.renderTexture; //          never gate off-screen RT renders

    if (isMainPass && rod.frameCountdown <= 0 && !continuousActive()) {
      rod.stats.skipped++;
      return; // skip the draw
    }
    if (isMainPass && rod.frameCountdown > 0) rod.frameCountdown--;
    if (isMainPass) rod.stats.rendered++;
    return original(displayObject, options);
  } as ((displayObject: unknown, options?: any) => unknown) & { __rod_original?: unknown };
  gated.__rod_original = original;
  renderer.render = gated;

  // HIGH-priority latch: sample pending render flags before Foundry's own
  // callbacks clear them. Any pending flag => render. v14 (board.mjs
  // `#activateTicker`) splits the queue into three — OBJECTS (HIGH-2),
  // INTERFACE (HIGH-3), PERCEPTION (NORMAL+2); v13 has only OBJECTS +
  // PERCEPTION. The HIGH latch still runs before all of them. `pf.INTERFACE`
  // is `undefined` on v13, so its term contributes 0 — one path serves both.
  const latch = () => {
    const pf = canvas?.pendingRenderFlags;
    if (!pf) return;
    const pending =
      (pf.OBJECTS?.size || 0) + (pf.INTERFACE?.size || 0) + (pf.PERCEPTION?.size || 0);
    if (pending > 0) rod.requestRender();
  };
  canvas.app.ticker.add(latch, undefined, PIXI.UPDATE_PRIORITY.HIGH);
  rod._latch = latch;

  // Interaction listeners on the canvas element: hover, drag, pan, zoom,
  // targeting all originate here. Passive — we only request a render.
  const view = canvas.app.view;
  if (view?.addEventListener) {
    const onInteract = () => rod.requestRender();
    for (const ev of ['pointermove', 'pointerdown', 'pointerup', 'wheel']) {
      view.addEventListener(ev, onInteract, { passive: true });
    }
    rod._view = view;
    rod._onInteract = onInteract;
  }

  // Force a few renders right after install / scene change.
  rod.requestRender(Math.max(rod.settleFrames, 5));
  rod.installed = true;
  if (rod.debug) console.log(`${MODULE_TITLE} | gate installed`);
}

/** Tear down the wrap on scene change so the next canvasReady re-installs clean. */
export function uninstallGate(): void {
  try {
    const renderer = canvas?.app?.renderer;
    if (renderer?.render?.__rod_original) renderer.render = renderer.render.__rod_original;
    if (rod._latch && canvas?.app?.ticker) canvas.app.ticker.remove(rod._latch);
    if (rod._view && rod._onInteract) {
      for (const ev of ['pointermove', 'pointerdown', 'pointerup', 'wheel']) {
        (rod._view as EventTarget).removeEventListener(
          ev,
          rod._onInteract as () => void,
          {
            passive: true,
          } as AddEventListenerOptions,
        );
      }
    }
  } catch (_e) {
    /* ignore */
  }
  rod._latch = rod._view = rod._onInteract = null;
  rod.installed = false;
}

/** Register discrete dirty-signal hooks that request a render. */
export function registerRenderHooks(): void {
  const req = () => rod.requestRender();

  // Camera + perception
  for (const h of ['canvasPan', 'lightingRefresh', 'sightRefresh', 'canvasInit']) {
    Hooks.on(h, req);
  }

  // Token lifecycle / interaction
  for (const h of ['refreshToken', 'controlToken', 'hoverToken', 'targetToken', 'updateToken']) {
    Hooks.on(h, req);
  }

  // Generic refresh<Object> / draw<Object> families fired per placeable type.
  const objects = [
    'Tile',
    'Drawing',
    'Wall',
    'AmbientLight',
    'AmbientSound',
    'Note',
    'MeasuredTemplate',
    'Region',
  ];
  for (const o of objects) {
    Hooks.on(`refresh${o}`, req);
    Hooks.on(`draw${o}`, req);
  }
  Hooks.on('drawLayer', req);
  Hooks.on('refreshLighting', req);
  Hooks.on('refreshVision', req);

  // Ruler / waypoints (dashed-line animation): keep rendering while measuring.
  for (const h of ['refreshRuler', 'moveToken']) Hooks.on(h, req);
}
