import { expect, it } from 'vitest';
import { evalLength } from '../components/PanZoom';
it('evaluates typed lengths', () => {
  expect(evalLength('600')).toBe(600);
  expect(evalLength(' 600 + 18 ')).toBe(618);
  expect(evalLength('2400/4')).toBe(600);
  expect(evalLength('100+2*50')).toBe(200);
  expect(evalLength('900-18.5')).toBe(881.5);
  expect(evalLength('750mm')).toBe(750);
  expect(evalLength('abc')).toBeNull();
  expect(evalLength('6/0')).toBeNull();
  expect(evalLength('')).toBeNull();
});
