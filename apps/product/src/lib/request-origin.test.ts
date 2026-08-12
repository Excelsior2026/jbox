import { describe, expect, it } from 'vitest';
import { publicRequestIsSameOrigin } from '@/lib/request-origin';

function request(origin: string | null, referer: string | null, url = 'https://field.usejbox.com/api/field/customers'): Request {
  const headers: Record<string, string> = {};
  if (origin) headers['origin'] = origin;
  if (referer) headers['referer'] = referer;
  return new Request(url, { method: 'POST', headers });
}

describe('publicRequestIsSameOrigin', () => {
  it('accepts a matching Origin', () => {
    expect(publicRequestIsSameOrigin(request('https://field.usejbox.com', null))).toBe(true);
  });

  it('rejects a cross-site Origin even with a matching Referer', () => {
    expect(publicRequestIsSameOrigin(
      request('https://evil.example', 'https://field.usejbox.com/page'),
    )).toBe(false);
  });

  it('falls back to Referer when Origin is absent', () => {
    expect(publicRequestIsSameOrigin(
      request(null, 'https://field.usejbox.com/estimates/abc'),
    )).toBe(true);
  });

  it('rejects a cross-site Referer', () => {
    expect(publicRequestIsSameOrigin(request(null, 'https://evil.example/x'))).toBe(false);
  });

  it('rejects requests with neither Origin nor Referer', () => {
    expect(publicRequestIsSameOrigin(request(null, null))).toBe(false);
  });

  it('rejects unparseable sources', () => {
    expect(publicRequestIsSameOrigin(request('not a url', null))).toBe(false);
    expect(publicRequestIsSameOrigin(request('', null))).toBe(false);
  });

  it('rejects a lookalike origin', () => {
    expect(publicRequestIsSameOrigin(
      request('https://field.usejbox.com.evil.example', null),
    )).toBe(false);
  });
});
