import type { Metadata } from 'next';
import OnboardingWizard from './onboarding-wizard';

export const metadata: Metadata = {
  title: 'Start your storefront — J-Box',
};

export default function OnboardingPage() {
  return (
    <main>
      <header className="site-header">
        <div className="container">
          <a className="brand-name" href="/">J-Box</a>
          <nav className="site-nav">
            <a className="button secondary" href="/">Back to home</a>
          </nav>
        </div>
      </header>

      <section className="hero">
        <div className="container">
          <div className="eyebrow">Onboarding</div>
          <h1>Start your storefront.</h1>
          <p>
            Tell us about your business and we will draft your site for you. Your
            storefront and your Field workspace are set up together.
          </p>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <OnboardingWizard />
        </div>
      </section>
    </main>
  );
}
