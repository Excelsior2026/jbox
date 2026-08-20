import type { Metadata } from 'next';
import JBoxSetupWizard from './jbox-setup-wizard';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'J-Box Workspace Setup',
};

export default function JBoxSetupPage() {
  return <JBoxSetupWizard />;
}
