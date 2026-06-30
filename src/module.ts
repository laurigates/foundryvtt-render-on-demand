import { MODULE_ID, MODULE_TITLE } from './constants';
import { installGate, registerRenderHooks, rod, uninstallGate } from './gate';
import { registerSettings } from './settings';

/** Namespaced console logger so module messages are easy to filter. */
function log(...args: unknown[]): void {
  console.log(`${MODULE_TITLE} |`, ...args);
}

// `init` — register settings + the discrete render-requesting hooks, and expose
// the controller for console/harness A/B. `game` data is NOT populated yet.
Hooks.once('init', () => {
  log(`Initializing ${MODULE_ID}`);
  registerSettings();
  registerRenderHooks();
  (window as unknown as { __rod: typeof rod }).__rod = rod;
});

// `canvasReady` — the renderer/ticker exist. Read settings, then (re)install the
// gate cleanly (a new scene rebuilds the renderer wiring).
Hooks.on('canvasReady', () => {
  rod.enabled = game.settings.get(MODULE_ID, 'enabled');
  rod.settleFrames = Number(game.settings.get(MODULE_ID, 'settleFrames')) || 0;
  rod.debug = game.settings.get(MODULE_ID, 'debug');
  uninstallGate();
  installGate();
});

// `canvasTearDown` — drop the wrap so the next canvasReady re-installs clean.
Hooks.on('canvasTearDown', () => {
  uninstallGate();
});
