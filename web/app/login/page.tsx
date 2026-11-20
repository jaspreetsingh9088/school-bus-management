'use client';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { api, APK_URL, saveSession } from '@/lib/api';

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api('/auth/login', { method: 'POST', body: { email, password } });
      if (!['COMPANY_ADMIN', 'OFFICE_STAFF'].includes(res.user.role)) {
        setError('This login is for the transport office. Parents and drivers use the mobile app.');
        return;
      }
      saveSession(res.token, res.user);
      router.replace('/dashboard/');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <div className="box">
        <h1>🚌 School Bus</h1>
        <p className="sub">Transport office login</p>
        <form onSubmit={submit}>
          {error && <div className="alert bad">{error}</div>}
          <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></label>
          <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
          <button className="primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          <div className="badge-demo">
            <b>Demo:</b> admin@example.com / ChangeMe!2026
          </div>
          <a href={APK_URL} className="small">Parents and drivers: download the Android app →</a>
        </form>
      </div>
    </div>
  );
}
