'use client';
import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { clean, ErrorNote, Shell, useForm } from '@/components/ui';
import { api, useApi } from '@/lib/api';

export default function Routes() {
  return <Shell><Body /></Shell>;
}

function Body() {
  const routes = useApi('/admin/routes');
  const schools = useApi('/admin/schools');
  const buses = useApi('/admin/buses');
  const staff = useApi('/admin/staff');
  const f = useForm({ name: '', schoolId: '', direction: 'MORNING', busId: '', driverId: '', attendantId: '' });
  const [error, setError] = useState<string | null>(null);
  const name = (list: any, id: string | null, key = 'name') => list?.find((x: any) => x.id === id)?.[key] ?? '—';
  const drivers = (staff.data ?? []).filter((u: any) => u.role === 'DRIVER');
  const attendants = (staff.data ?? []).filter((u: any) => u.role === 'ATTENDANT');

  async function add(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const r = await api('/admin/routes', { method: 'POST', body: clean(f.values) });
      window.location.href = `/route-detail/?id=${r.id}`;
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <>
      <h1>Routes</h1>
      <p className="sub">Make a separate route for the morning pickup and the afternoon drop-off. Open a route to set its stops and children.</p>
      <ErrorNote error={error ?? routes.error} />
      <div className="panel">
        <h2>New route</h2>
        <form className="inline" onSubmit={add}>
          <label>Name<input required placeholder="Route 3 — Morning" {...f.bind('name')} /></label>
          <label>School
            <select required {...f.bind('schoolId')}><option value="">Choose…</option>{(schools.data ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          </label>
          <label>Trip<select {...f.bind('direction')}><option value="MORNING">Morning pickup</option><option value="AFTERNOON">Afternoon drop-off</option></select></label>
          <label>Bus<select {...f.bind('busId')}><option value="">—</option>{(buses.data ?? []).map((b: any) => <option key={b.id} value={b.id}>{b.registrationNumber}</option>)}</select></label>
          <label>Driver<select {...f.bind('driverId')}><option value="">—</option>{drivers.map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
          <label>Attendant<select {...f.bind('attendantId')}><option value="">—</option>{attendants.map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
          <button className="primary">Create route</button>
        </form>
      </div>
      <div className="panel">
        <table>
          <thead><tr><th>Route</th><th>Trip</th><th>School</th><th>Bus</th><th>Driver</th><th>Attendant</th><th /></tr></thead>
          <tbody>
            {(routes.data ?? []).map((r: any) => (
              <tr key={r.id}>
                <td><b>{r.name}</b></td>
                <td>{r.direction === 'MORNING' ? 'Morning' : 'Afternoon'}</td>
                <td>{name(schools.data, r.schoolId)}</td>
                <td>{name(buses.data, r.busId, 'registrationNumber')}</td>
                <td>{name(staff.data, r.driverId)}</td>
                <td>{name(staff.data, r.attendantId)}</td>
                <td><Link href={`/route-detail/?id=${r.id}`}>Stops & children</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
