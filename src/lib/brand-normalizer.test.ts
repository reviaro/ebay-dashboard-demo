import { describe, it, expect } from 'vitest';
import { normalizeBrand, matchBrandWord } from './brand-normalizer';

describe('normalizeBrand', () => {
  it('maps known aliases to canonical names', () => {
    expect(normalizeBrand('VW')).toBe('Volkswagen');
    expect(normalizeBrand('vw')).toBe('Volkswagen');
    expect(normalizeBrand('Mercedes')).toBe('Mercedes-Benz');
    expect(normalizeBrand('Benz')).toBe('Mercedes-Benz');
    expect(normalizeBrand('chevy')).toBe('Chevrolet');
    expect(normalizeBrand('Rolls')).toBe('Rolls-Royce');
    expect(normalizeBrand('Alfa')).toBe('Alfa Romeo');
  });

  it('returns Unknown for null, undefined, or blank input', () => {
    expect(normalizeBrand(null)).toBe('Unknown');
    expect(normalizeBrand(undefined)).toBe('Unknown');
    expect(normalizeBrand('   ')).toBe('Unknown');
  });

  it('maps Land/Rover fragments from "Land Rover" titles to Land Rover', () => {
    expect(normalizeBrand('Land')).toBe('Land Rover');
    expect(normalizeBrand('LAND')).toBe('Land Rover');
    expect(normalizeBrand('Rover')).toBe('Land Rover');
    expect(normalizeBrand('land rover')).toBe('Land Rover');
  });

  it('canonicalizes casing of known makes', () => {
    expect(normalizeBrand('VOLVO')).toBe('Volvo');
    expect(normalizeBrand('volvo')).toBe('Volvo');
    expect(normalizeBrand('MERCEDES-BENZ')).toBe('Mercedes-Benz');
    expect(normalizeBrand('BMW')).toBe('BMW');
    expect(normalizeBrand('bmw')).toBe('BMW');
  });

  it('is not confused by Object prototype property names', () => {
    expect(normalizeBrand('constructor')).toBe('constructor');
    expect(normalizeBrand('toString')).toBe('toString');
    expect(normalizeBrand('hasOwnProperty')).toBe('hasOwnProperty');
  });

  it('passes through unknown brands unchanged', () => {
    expect(normalizeBrand('Peterbilt')).toBe('Peterbilt');
  });
});

describe('matchBrandWord', () => {
  it('matches canonical makes and aliases case-insensitively', () => {
    expect(matchBrandWord('Volvo')).toBe('Volvo');
    expect(matchBrandWord('VW')).toBe('Volkswagen');
    expect(matchBrandWord('Land')).toBe('Land Rover');
  });

  it('returns null for non-make words', () => {
    expect(matchBrandWord('Steering')).toBeNull();
    expect(matchBrandWord('constructor')).toBeNull();
  });
});
