import { describe, expect, it } from 'vitest';
import { classifyHost, tenantSubdomainFromHost } from '@/lib/host';

describe('tenantSubdomainFromHost', () => {
  it('extracts the tenant subdomain from *.usejbox.com hosts', () => {
    expect(tenantSubdomainFromHost('paris.usejbox.com')).toBe('paris');
    expect(tenantSubdomainFromHost('PARIS.USEJBOX.COM')).toBe('paris');
  });

  it('strips a port', () => {
    expect(tenantSubdomainFromHost('paris.usejbox.com:3001')).toBe('paris');
  });

  it('rejects platform hosts', () => {
    for (const host of ['usejbox.com', 'www.usejbox.com', 'app.usejbox.com', 'field.usejbox.com']) {
      expect(tenantSubdomainFromHost(host)).toBeNull();
    }
  });

  it('rejects suffix spoofing and unrelated hosts', () => {
    expect(tenantSubdomainFromHost('paris.usejbox.com.evil.com')).toBeNull();
    expect(tenantSubdomainFromHost('usejbox.com.evil.com')).toBeNull();
    expect(tenantSubdomainFromHost('example.com')).toBeNull();
    expect(tenantSubdomainFromHost('localhost')).toBeNull();
    expect(tenantSubdomainFromHost(null)).toBeNull();
    expect(tenantSubdomainFromHost('')).toBeNull();
  });
});

describe('classifyHost', () => {
  it('classifies tenant, platform, and unknown hosts', () => {
    expect(classifyHost('paris.usejbox.com')).toBe('tenant');
    expect(classifyHost('usejbox.com')).toBe('platform');
    expect(classifyHost('field.usejbox.com')).toBe('platform');
    expect(classifyHost('some.other.domain')).toBe('unknown');
    expect(classifyHost(null)).toBe('unknown');
  });
});
