import { describe, expect, test } from 'vitest';

import { normaliseAltitude } from './altitude.js';

describe('normaliseAltitude', () => {
  test('reads a single value in metres above sea level', () => {
    expect(normaliseAltitude('1800 masl')).toEqual({ minM: 1800, maxM: 1800 });
  });
});
