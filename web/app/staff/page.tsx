'use client';
import { FormEvent, useState } from 'react';
import { clean, ErrorNote, Pill, Shell, useForm } from '@/components/ui';
import { api, timeAgo, useApi } from '@/lib/api';

export default function Staff() {
  return <Shell><Body /></Shell>;
}

const ROLE: Record<string, string> = { DRIVER: 'Driver', ATTENDANT: 'Attendant', OFFICE_STAFF: 'Office staff', COMPANY_ADMIN: 'Admin' };

function Body() {
  const staff = useApi('/admin/staff');
  const f = useForm({ role: 'DRIVER', name: '', phone: '', email: '', password: '', licenseNumber: '', licenseExpiry: '' });
  const [error, setError] = useState<string | null>(null);
  const office = f.values.role === 'OFFICE_STAFF' || f.values.role === 'COMPANY_ADMIN';

  async function add(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api('/admin/staff', { method: 'POST', body: clean(f.values) });
      f.reset();
      staff.reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function toggle(id: string, active: boolean) {
    await api(`/admin/users/${id}/active/${active}`, { method: 'POST' });
    staff.reload();
  }

  return (
    <>
      <h1>Drivers & staff</h1>
      <p className="sub">Drivers and attendants log in to the app with their mobile number. Office staff log in here with email and password.</p>
      <ErrorNote error={error ?? staff.error} />
      <div className="panel">
        <h2>Add a person</h2>
        <form className="inline" onSubmit={add}>
          <label>Role
            <select {...f.bind('role')}>{Object.entries(ROLE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </label>
          <label>Name<input required {...f.bind('name')} /></label>
          <label>Mobile number<input required {...f.bind('phone')} /></label>
          {office && <label>Email<input type="email" required {...f.bind('email')} /></label>}
          {office && <label>Password<input type="password" required minLength={8} {...f.bind('password')} /></label>}
          {f.values.role === 'DRIVER' && <label>Licence number<input {...f.bind('licenseNumber')} /></label>}
          {f.values.role === 'DRIVER' && <label>Licence expiry<input type="date" {...f.bind('licenseExpiry')} /></label>}
          <button className="primary">Add</button>
        </form>
      </div>
      <div className="panel">
        <table>
          <thead><tr><th>Name</th><th>Role</th><th>Mobile</th><th>Licence</th><th>Last login</th><th>Status</th><th /></tr></thead>
          <tbody>
            {(staff.data ?? []).map((u: any) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td>{ROLE[u.role] ?? u.role}</td>
                <td>{u.phone}</td>
                <td>{u.licenseNumber ? `${u.licenseNumber} (to ${u.licenseExpiry ?? '?'})` : '—'}</td>
                <td className="muted">{u.lastLoginAt ? timeAgo(u.lastLoginAt) : 'never'}</td>
                <td><Pill status={u.active ? 'ACTIVE' : 'INACTIVE'} /></td>
                <td><button onClick={() => toggle(u.id, !u.active)}>{u.active ? 'Deactivate' : 'Activate'}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
