'use client';
import Link from 'next/link';
import { useState } from 'react';
import { TripTable } from '@/components/TripTable';
import { ErrorNote, Map, Pill, Shell } from '@/components/ui';
import { api, timeAgo, todayIST, useApi } from '@/lib/api';

export default function Dashboard() {
  return <Shell><DashboardBody /></Shell>;
}

function DashboardBody() {
  const dash = useApi('/admin/dashboard', 8000);
  const trips = useApi(`/admin/trips?date=${todayIST()}`, 8000);
  const [note] = useState<string | null>(null);
  const d = dash.data;


  if (!d) return <><h1>Live view</h1><ErrorNote error={dash.error} />{dash.loading && <p className="muted">Loading…</p>}</>;
  const a = d.alerts;
  const items = [
    ...a.needsAttention.map((x: any) => ({ key: x.tripId + x.studentId, text: <><b>{x.name}</b> <Pill status={x.status} /></>, tripId: x.tripId })),
    ...a.signalLost.map((x: any) => ({ key: 'gps' + x.tripId, text: <>Bus GPS lost — last seen {timeAgo(x.lastPositionAt)}</>, tripId: x.tripId })),
    ...a.emptyBusCheckMissing.map((id: string) => ({ key: 'eb' + id, text: <>Trip ended without the empty-bus check</>, tripId: id })),
    ...a.openIncidents.map((i: any) => ({
      key: i.id,
      text: <><b>{i.type === 'SOS' ? 'SOS' : i.type.toLowerCase()}</b> {i.note ?? ''} <span className="muted small">{timeAgo(i.createdAt)}</span></>,
      action: <button onClick={async () => { await api(`/admin/incidents/${i.id}/resolve`, { method: 'POST' }); dash.reload(); }}>Resolved</button>,
    })),
    ...d.expiring.buses.map((b: any) => ({ key: 'bus' + b.id, text: <>Bus {b.registrationNumber}: a document expires soon</>, link: '/buses/' })),
    ...d.expiring.licences.map((l: any) => ({ key: 'lic' + l.userId, text: <>{l.name}: driving licence expires {l.licenseExpiry}</>, link: '/staff/' })),
  ];

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Live view</h1>
          <p className="sub">{new Date(d.date).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })} · updates by itself</p>
        </div>
      </div>
      {note && <div className="alert good">{note}</div>}

      <div className="tiles">
        <div className="tile"><div className="n">{d.trips.running}</div><div className="l">Buses on the road</div></div>
        <div className="tile"><div className="n">{d.students.travellingNow}</div><div className="l">Children on buses now</div></div>
        <div className="tile"><div className="n">{d.students.droppedOff}</div><div className="l">Reached school / home</div></div>
        <div className={`tile${items.length ? ' hot' : ''}`}><div className="n">{items.length}</div><div className="l">Need attention</div></div>
      </div>

      <div className="grid two">
        <div className="panel">
          <h2>Where are the buses?</h2>
          <Map
            tall
            points={d.liveBuses.filter((b: any) => b.lat !== null).map((b: any) => ({
              id: b.tripId, lat: b.lat, lng: b.lng, kind: 'bus' as const,
              label: `${trips.data?.find((t: any) => t.trip.id === b.tripId)?.routeName ?? 'Bus'} · ${Math.round(b.speedKmh ?? 0)} km/h · ${timeAgo(b.at)}`,
            }))}
            fitKey={d.liveBuses.map((b: any) => b.tripId).join(',')}
          />
          {!d.liveBuses.length && <p className="muted small">No bus is on the road. A bus appears here when its driver taps “Start trip” in the app.</p>}
        </div>
        <div className="panel">
          <h2>Needs attention</h2>
          {items.length === 0 && <p className="empty">✓ All clear</p>}
          {items.map((it: any) => (
            <div key={it.key} className="attention">
              <span>{it.text}</span>
              {it.action ?? (it.tripId ? <Link href={`/trip/?id=${it.tripId}`}>Open</Link> : it.link ? <Link href={it.link}>Open</Link> : null)}
            </div>
          ))}
        </div>
      </div>

      <div className="panel flush">
        <div className="toolbar"><b>Today’s trips</b></div>
        <div style={{ padding: '0 8px' }}><TripTable rows={trips.data ?? []} onChanged={() => { trips.reload(); dash.reload(); }} /></div>
      </div>
    </>
  );
}
