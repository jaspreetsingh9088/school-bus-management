'use client';
import { FormEvent, useState } from 'react';
import { clean, ErrorNote, Map, Shell, useForm } from '@/components/ui';
import { api, useApi } from '@/lib/api';

export default function Schools() {
  return <Shell><Body /></Shell>;
}

function Body() {
  const schools = useApi('/admin/schools');
  const f = useForm({ name: '', address: '', phone: '', lat: '', lng: '' });
  const [error, setError] = useState<string | null>(null);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const body: Record<string, unknown> = clean(f.values);
      if (f.values.lat) body.lat = Number(f.values.lat);
      if (f.values.lng) body.lng = Number(f.values.lng);
      await api('/admin/schools', { method: 'POST', body });
      f.reset();
      schools.reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const points = [
    ...(schools.data ?? []).filter((s: any) => s.lat !== null).map((s: any) => ({ id: s.id, lat: s.lat, lng: s.lng, kind: 'school' as const, label: s.name })),
    ...(f.values.lat ? [{ id: 'new', lat: Number(f.values.lat), lng: Number(f.values.lng), kind: 'pin' as const, text: '+', label: 'New school' }] : []),
  ];

  return (
    <>
      <h1>Schools</h1>
      <p className="sub">Click the map to set the school’s location. It is used for “distance to school” in the parent app.</p>
      <ErrorNote error={error ?? schools.error} />
      <div className="grid two">
        <div className="panel">
          <Map points={points} onPick={(lat, lng) => f.setValues((v) => ({ ...v, lat: String(lat), lng: String(lng) }))}
            fitKey={(schools.data ?? []).map((s: any) => s.id).join(',')} />
        </div>
        <div className="panel">
          <h2>Add a school</h2>
          <form className="inline" onSubmit={add} style={{ gridTemplateColumns: '1fr 1fr' }}>
            <label style={{ gridColumn: 'span 2' }}>Name<input required {...f.bind('name')} /></label>
            <label style={{ gridColumn: 'span 2' }}>Address<input {...f.bind('address')} /></label>
            <label>Phone<input {...f.bind('phone')} /></label>
            <span />
            <label>Latitude<input {...f.bind('lat')} /></label>
            <label>Longitude<input {...f.bind('lng')} /></label>
            <button className="primary" style={{ gridColumn: 'span 2' }}>Add school</button>
          </form>
        </div>
      </div>
      <div className="panel">
        <table>
          <thead><tr><th>School</th><th>Address</th><th>Phone</th></tr></thead>
          <tbody>{(schools.data ?? []).map((s: any) => <tr key={s.id}><td>{s.name}</td><td>{s.address ?? '—'}</td><td>{s.phone ?? '—'}</td></tr>)}</tbody>
        </table>
      </div>
    </>
  );
}
