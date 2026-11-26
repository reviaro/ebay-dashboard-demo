import { describe, expect, it } from 'vitest';
import { envNumber } from './constants';

describe('envNumber', () => {
  it('uses the fallback when the variable is unset or blank', () => {
    expect(envNumber(undefined, 10000)).toBe(10000);
    expect(envNumber('  ', 10000)).toBe(10000);
  });

  it('uses a configured store goal', () => {
    expect(envNumber('12500', 10000)).toBe(12500);
    expect(envNumber('0.2', 0.1)).toBe(0.2);
  });

  it('ignores a value that is not a finite number', () => {
    expect(envNumber('ten thousand', 10000)).toBe(10000);
    expect(envNumber('Infinity', 10000)).toBe(10000);
  });

  it('ignores zero and negative goals, which would divide progress by zero', () => {
    expect(envNumber('0', 0.1)).toBe(0.1);
    expect(envNumber('-5', 10000)).toBe(10000);
  });
});
