import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './dispatch.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'J-Box Dispatch Portal',
  description: 'Licensed and insured trade operations — live field dispatch.',
  robots: { index: false, follow: false },
};

export default function DispatchLayout({ children }: { children: ReactNode }) {
  return (
    <div className="dispatch-shell">
      {children}
    </div>
  );
}
