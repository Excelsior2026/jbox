import { describe, expect, it } from 'vitest';
import { getClientIp, rateLimit } from './rate-limit';

describe('rateLimit', () => {
  it('exhausts the default capacity', () => {
    const key = 'default-capacity-test';
    const now = 1_000_000;

    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect(rateLimit(key, undefined, now)).toBe(true);
    }
    expect(rateLimit(key, undefined, now)).toBe(false);
  });

  it('refills tokens over time', () => {
    const key = 'time-refill-test';
    const now = 2_000_000;

    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect(rateLimit(key, undefined, now)).toBe(true);
    }
    expect(rateLimit(key, undefined, now)).toBe(false);
    expect(rateLimit(key, undefined, now + 6_000)).toBe(true);
    expect(rateLimit(key, undefined, now + 6_000)).toBe(false);
  });

  it('honors custom capacity and refill settings', () => {
    const key = 'custom-options-test';
    const now = 3_000_000;
    const options = { capacity: 2, refillPerMinute: 1 };

    expect(rateLimit(key, options, now)).toBe(true);
    expect(rateLimit(key, options, now)).toBe(true);
    expect(rateLimit(key, options, now)).toBe(false);
    expect(rateLimit(key, options, now + 60_000)).toBe(true);
  });
});

describe('getClientIp', () => {
  it('returns the trimmed first forwarded address', () => {
    const request = new Request('https://example.com', {
      headers: { 'x-forwarded-for': ' 203.0.113.7, 198.51.100.2 ' },
    });

    expect(getClientIp(request)).toBe('203.0.113.7');
  });

  it('returns unknown when the forwarded header is missing', () => {
    const request = new Request('https://example.com');

    expect(getClientIp(request)).toBe('unknown');
  });
});
