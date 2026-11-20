'use client';
import { FormEvent, useState } from 'react';
import { clean, ErrorNote, Pill, Shell, useForm } from '@/components/ui';
import { api, useApi } from '@/lib/api';

export default function Buses() {
  return <Shell><Body /></Shell>;
}

function Body() {
  const buses = useApi('/admin/buses');
  const f = useForm({ registrationNumber: '', fleetNumber: '', capacity: '', model: '', insuranceExpiry: '', fitnessExpiry: '', permitExpiry: '' });
  const [error, setError] = useState<string | null>(null);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api('/admin/buses', { method: 'POST', body: { ...clean(f.values), capacity: Number(f.values.capacity) } });
      f.reset();
      buses.reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function setStatus(id: string, status: string) {
    await api(`/admin/buses/${id}`, { method: 'PATCH', body: { status } });
    buses.reload();
  }

  return (
    <>
      <h1>Buses</h1>
      <ErrorNote error={error ?? buses.error} />
      <div className="panel">
        <h2>Add a bus</h2>
        <form className="inline" onSubmit={add}>
          <label>Registration number<input required placeholder="PB10AB1234" {...f.bind('registrationNumber')} /></label>
          <label>Fleet name / number<input {...f.bind('fleetNumber')} /></label>
          <label>Seats<input required type="number" min={1} {...f.bind('capacity')} /></label>
          <label>Model<input {...f.bind('model')} /></label>
          <label>Insurance expiry<input type="date" {...f.bind('insuranceExpiry')} /></label>
          <label>Fitness expiry<input type="date" {...f.bind('fitnessExpiry')} /></label>
          <label>Permit expiry<input type="date" {...f.bind('permitExpiry')} /></label>
          <button className="primary">Add bus</button>
        </form>
      </div>
      <div className="panel">
        <table>
          <thead><tr><th>Registration</th><th>Fleet</th><th>Seats</th><th>Insurance</th><th>Fitness</th><th>Permit</th><th>Status</th></tr></thead>
          <tbody>
            {(buses.data ?? []).map((b: any) => (
              <tr key={b.id}>
                <td><b>{b.registrationNumber}</b></td>
                <td>{b.fleetNumber ?? '—'}</td>
                <td>{b.capacity}</td>
                <td>{b.insuranceExpiry ?? '—'}</td>
                <td>{b.fitnessExpiry ?? '—'}</td>
                <td>{b.permitExpiry ?? '—'}</td>
                <td>
                  <div className="row"><Pill status={b.status} />
                    <select value={b.status} onChange={(e) => setStatus(b.id, e.target.value)} style={{ width: 130 }}>
                      <option value="ACTIVE">Active</option><option value="MAINTENANCE">Maintenance</option><option value="INACTIVE">Inactive</option>
                    </select>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
