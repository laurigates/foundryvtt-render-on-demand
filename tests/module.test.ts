import { describe, expect, it } from 'vitest';
import { MODULE_ID } from '../src/constants';
import { continuousActive, rod } from '../src/gate';
import { registerSettings } from '../src/settings';

describe('render-on-demand', () => {
  it('exposes the expected module id', () => {
    expect(MODULE_ID).toBe('render-on-demand');
  });

  it('registers settings without throwing', () => {
    expect(() => registerSettings()).not.toThrow();
  });
});

describe('render gate', () => {
  it('requestRender raises the frame countdown to at least the requested frames', () => {
    rod.frameCountdown = 0;
    rod.requestRender(5);
    expect(rod.frameCountdown).toBeGreaterThanOrEqual(5);
    // never lowers an already-higher countdown
    rod.requestRender(2);
    expect(rod.frameCountdown).toBeGreaterThanOrEqual(5);
    rod.frameCountdown = 0;
  });

  it('continuousActive fail-safes to true when the canvas is unavailable', () => {
    // Under Node `canvas` is not defined; the predicate must catch and render
    // rather than risk freezing a real canvas it cannot inspect.
    expect(continuousActive()).toBe(true);
  });
});
