import { MODULE_ID } from './constants';
import { rod } from './gate';

/** Register this module's settings. Called from the `init` hook. The `name` and
 * `hint` values are i18n keys (resolved at render time), not literal strings.
 * Settings are client-scoped: render-on-demand is a per-client performance
 * preference, and the runtime `enabled` toggle is also flipped per-client via
 * `window.__rod.enabled`. */
export function registerSettings(): void {
  game.settings.register(MODULE_ID, 'enabled', {
    name: `${MODULE_ID}.Settings.Enabled.Name`,
    hint: `${MODULE_ID}.Settings.Enabled.Hint`,
    scope: 'client',
    config: true,
    type: Boolean,
    default: true,
    requiresReload: false,
    onChange: (v: boolean) => {
      rod.enabled = v;
      if (v) rod.requestRender(Math.max(rod.settleFrames, 5));
    },
  });

  game.settings.register(MODULE_ID, 'settleFrames', {
    name: `${MODULE_ID}.Settings.SettleFrames.Name`,
    hint: `${MODULE_ID}.Settings.SettleFrames.Hint`,
    scope: 'client',
    config: true,
    type: Number,
    default: 3,
    requiresReload: false,
    onChange: (v: number) => {
      rod.settleFrames = Number(v) || 0;
    },
  });

  game.settings.register(MODULE_ID, 'debug', {
    name: `${MODULE_ID}.Settings.Debug.Name`,
    hint: `${MODULE_ID}.Settings.Debug.Hint`,
    scope: 'client',
    config: true,
    type: Boolean,
    default: false,
    requiresReload: false,
    onChange: (v: boolean) => {
      rod.debug = v;
    },
  });
}

/** Read a module setting. */
export function getSetting(key: string): unknown {
  return game.settings.get(MODULE_ID, key);
}
