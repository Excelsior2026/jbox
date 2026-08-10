import { describe, expect, it } from 'vitest';
import { canonicalize, contentHash } from './estimate-document';

describe('canonicalize', () => {
  it('is independent of object key order', () => {
    expect(canonicalize({ a: 1, b: 2 })).toBe(canonicalize({ b: 2, a: 1 }));
  });
  it('preserves array order', () => {
    expect(canonicalize([1, 2])).not.toBe(canonicalize([2, 1]));
  });
  it('handles nested structures and null', () => {
    expect(canonicalize({ x: [{ q: 1, p: 2 }], y: null }))
      .toBe(canonicalize({ y: null, x: [{ p: 2, q: 1 }] }));
  });
});

describe('contentHash', () => {
  it('is a 64-char lowercase hex string', () => {
    expect(contentHash({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });
  it('is stable across key order but changes with values', () => {
    expect(contentHash({ a: 1, b: 2 })).toBe(contentHash({ b: 2, a: 1 }));
    expect(contentHash({ a: 1 })).not.toBe(contentHash({ a: 2 }));
  });
});
