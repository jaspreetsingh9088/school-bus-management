'use client';
import { FormEvent, useState } from 'react';
import { clean, ErrorNote, Map, Shell, useForm } from '@/components/ui';
import { api, useApi } from '@/lib/api';

export default function Stops() {
  return <Shell><Body /></Shell>;
}

function Body() {
  const stops = useApi('/admin/stops');
  const f = useForm({ name: '', address: '', lat: '', lng: '' });
  const [error, setError] = useState<string | null>(null);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api('/admin/stops', { method: 'POST', body: { ...clean(f.values), lat: Number(f.values.lat), lng: Number(f.values.lng) } });
      f.reset();
      stops.reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      await api(`/admin/stops/${id}`, { method: 'DELETE' });
      stops.reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const points = [
    ...(stops.data ?? []).map((s: any) => ({ id: s.id, lat: s.lat, lng: s.lng, kind: 'stop' as const, text: '', label: s.name })),
    ...(f.values.lat && f.values.lng ? [{ id: 'new', lat: Number(f.values.lat), lng: Number(f.values.lng), kind: 'pin' as const, text: '+', label: 'New stop' }] : []),
  ];

  return (
    <>
      <h1>Stops</h1>
      <p className="sub">Click the map to place a new pickup or drop-off point.</p>
      <ErrorNote error={error ?? stops.error} />
      <div className="grid two">
        <div className="panel">
          <Map points={points} onPick={(lat, lng) => f.setValues((v) => ({ ...v, lat: String(lat), lng: String(lng) }))} tall
            fitKey={(stops.data ?? []).map((s: any) => s.id).join(',')} />
        </div>
        <div>
          <div className="panel">
            <h2>New stop</h2>
            <form className="inline" onSubmit={add} style={{ gridTemplateColumns: '1fr 1fr' }}>
              <label style={{ gridColumn: 'span 2' }}>Name<input required placeholder="e.g. Model Town gate 2" {...f.bind('name')} /></label>
              <label style={{ gridColumn: 'span 2' }}>Address (optional)<input {...f.bind('address')} /></label>
              <label>Latitude<input required {...f.bind('lat')} /></label>
              <label>Longitude<input required {...f.bind('lng')} /></label>
              <button className="primary" style={{ gridColumn: 'span 2' }}>Add stop</button>
            </form>
          </div>
          <div className="panel">
            <h2>All stops ({stops.data?.length ?? 0})</h2>
            <table><tbody>
              {(stops.data ?? []).map((s: any) => (
                <tr key={s.id}><td>{s.name}<div className="muted small">{s.lat.toFixed(5)}, {s.lng.toFixed(5)}</div></td>
                  <td style={{ textAlign: 'right' }}><button className="danger" onClick={() => remove(s.id)}>Delete</button></td></tr>
              ))}
            </tbody></table>
          </div>
        </div>
      </div>
    </>
  );
}
