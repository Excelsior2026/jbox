'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './field.module.css';

type Notice = { kind: 'error' | 'info'; message: string };

const ERROR_MESSAGES: Record<string, string> = {
  'invalid-credentials': 'Email or password is incorrect.',
  'too-many-requests': 'Too many attempts. Please wait a moment and try again.',
  'invalid-body': 'Enter your email and password.',
  'organization-required': 'This account belongs to more than one organization. Contact an administrator.',
};

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const payload = await response.json() as { error?: string; ok?: boolean };
      if (!response.ok || !payload.ok) {
        setNotice({
          kind: 'error',
          message: ERROR_MESSAGES[payload.error ?? ''] ?? 'Sign-in failed.',
        });
        return;
      }
      router.push('/field');
      router.refresh();
    } catch {
      setNotice({ kind: 'error', message: 'Sign-in failed. Please try again.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.loginForm} onSubmit={submit}>
      <label className={styles.fieldLabel} htmlFor="email">Email</label>
      <input
        id="email"
        className={styles.searchInput}
        autoComplete="email"
        autoFocus
        inputMode="email"
        maxLength={320}
        required
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <label className={styles.fieldLabel} htmlFor="password">Password</label>
      <input
        id="password"
        className={styles.searchInput}
        autoComplete="current-password"
        required
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      {notice && (
        <p className={notice.kind === 'error' ? styles.alertError : styles.alertOk} role="alert">
          {notice.message}
        </p>
      )}
      <button className={styles.button} disabled={busy || !email || !password} type="submit">
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
