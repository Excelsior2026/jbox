import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { hostnameOf } from '@/lib/host';
import MarketingLanding from './marketing-landing';

export const metadata: Metadata = {
  title: 'J-Box — Storefront and Field for small trade contractors',
  description:
    'Professional customer storefronts and a Field workspace for estimates, jobs, and invoices. Every lead flows from your site straight into your work queue.',
};

/**
 * The platform surface, served on the apex domain, app.usejbox.com, and any
 * deployment hostname (the proxy rewrites those here). Public and tenant-free
 * by construction.
 *
 * Host-branched: field.usejbox.com is the Field sign-in host and sends its
 * root straight to the workspace; every other platform host gets the product
 * landing page.
 */
export default async function PlatformPage() {
  const host = hostnameOf((await headers()).get('host'));
  if (host === 'field.usejbox.com') {
    redirect('/field');
  }
  return <MarketingLanding />;
}
