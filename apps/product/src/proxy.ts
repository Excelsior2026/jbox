import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { classifyHost } from '@/lib/host';

/**
 * Host-shape routing gate (Next 16 calls this file proxy.ts; middleware is
 * deprecated).
 *
 * Tenant storefronts live on `*.usejbox.com` subdomains and are resolved per
 * request in withTenant()/loadStorefront() — that needs the database, so it
 * happens in render, not here. What proxy CAN do without I/O is gate on host
 * shape: platform hosts and unknown hostnames are rewritten onto the static
 * platform shell so a tenant page can never be reached under a non-tenant
 * host. The DB-level verification still happens in withTenant(), which fails
 * closed.
 *
 * API routes are left alone: they resolve (and reject) tenants on their own.
 */

export function proxy(request: NextRequest) {
  if (classifyHost(request.headers.get('host')) === 'tenant') {
    return NextResponse.next();
  }

  if (request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  const pathname = request.nextUrl.pathname;
  if (pathname === '/platform' || pathname.startsWith('/platform/')) {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.pathname = `/platform${pathname === '/' ? '' : pathname}`;
  url.search = request.nextUrl.search;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
