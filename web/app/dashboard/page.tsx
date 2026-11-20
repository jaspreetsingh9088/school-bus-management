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
  const [note, setNote] = useState<string | null>(null);
  const d = dash.data;

  async function generate() {
    const res = await api('/admin/trips/generate', { method: 'POST', body: { date: todayIST() } });
    setNote(`${res.created} trip(s) created for today.`);
    trips.reload();
    dash.reload();
  }

  if (!d) return <><h1>Dashboard</h1><ErrorNote error={dash.error} />{dash.loading && <p className="muted">Loading…</p>}</>;
  const alerts = d.alerts;
  const alertCount = alerts.needsAttention.length + alerts.signalLost.length + alerts.openIncidents.length + alerts.emptyBusCheckMissing.length;

  return (
    <>
      <div className="row between">
        <div>
          <h1>Today, {new Date(d.date).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</h1>
          <p className="sub">Updates every few seconds.</p>
        </div>
        <button onClick={generate}>Create today’s trips</button>
      </div>
      {note && <div className="alert good">{note}</div>}

      <div className="grid cards">
        <Stat n={d.trips.running} l="Buses running" />
        <Stat n={d.students.travellingNow} l="Children on buses" />
        <Stat n={d.students.droppedOff} l="Dropped / at school" />
        <Stat n={d.students.absent} l="Absent today" />
        <Stat n={d.trips.scheduled} l="Trips today" />
        <Stat n={d.totals.students} l="Students" />
        <Stat n={d.totals.activeBuses} l="Active buses" />
        <Stat n={d.totals.parents} l="Parents" />
      </div>

      <div className="grid two">
        <div className="panel">
          <h2>Live buses</h2>
          <Map
            points={d.liveBuses.filter((b: any) => b.lat !== null).map((b: any) => ({
              id: b.tripId, lat: b.lat, lng: b.lng, kind: 'bus' as const,
              label: `${trips.data?.find((t: any) => t.trip.id === b.tripId)?.busNumber ?? 'Bus'} · ${Math.round(b.speedKmh ?? 0)} km/h · ${timeAgo(b.at)}`,
            }))}
            fitKey={d.liveBuses.map((b: any) => b.tripId).join(',')}
          />
          {!d.liveBuses.length && <p className="muted small">No bus is running right now. Buses appear here when a driver starts a trip in the app.</p>}
        </div>

        <div className="panel">
          <h2>Needs attention {alertCount > 0 && <span className="pill bad">{alertCount}</span>}</h2>
          {alertCount === 0 && <p className="empty">All clear.</p>}
          {alerts.needsAttention.map((a: any) => (
            <div key={a.tripId + a.studentId} className="row between" style={{ padding: '6px 0' }}>
              <span>{a.name}</span>
              <span className="row"><Pill status={a.status} /><Link href={`/trip/?id=${a.tripId}`}>Open trip</Link></span>
            </div>
          ))}
          {alerts.signalLost.map((a: any) => (
            <div key={a.tripId} className="alert warn">GPS signal lost — last update {timeAgo(a.lastPositionAt)}. <Link href={`/trip/?id=${a.tripId}`}>Open trip</Link></div>
          ))}
          {alerts.emptyBusCheckMissing.map((id: string) => (
            <div key={id} className="alert bad">A trip ended without the empty-bus check. <Link href={`/trip/?id=${id}`}>Open trip</Link></div>
          ))}
          {alerts.openIncidents.map((i: any) => (
            <div key={i.id} className="alert bad">
              <b>{i.type}</b> {i.note ?? ''} <span className="small">({timeAgo(i.createdAt)})</span>
              <div className="row" style={{ marginTop: 6 }}>
                {i.lat && <a href={`https://maps.google.com/?q=${i.lat},${i.lng}`} target="_blank" rel="noreferrer">Location</a>}
                <button onClick={async () => { await api(`/admin/incidents/${i.id}/resolve`, { method: 'POST' }); dash.reload(); }}>Mark resolved</button>
              </div>
            </div>
          ))}
          {(d.expiring.buses.length > 0 || d.expiring.licences.length > 0) && (
            <>
              <h2 style={{ marginTop: 16 }}>Documents expiring in 30 days</h2>
              {d.expiring.buses.map((b: any) => <div key={b.id} className="small">Bus {b.registrationNumber}: insurance {b.insuranceExpiry ?? '—'}, fitness {b.fitnessExpiry ?? '—'}, permit {b.permitExpiry ?? '—'}</div>)}
              {d.expiring.licences.map((l: any) => <div key={l.userId} className="small">Driver {l.name}: licence {l.licenseExpiry}</div>)}
            </>
          )}
        </div>
      </div>

      <div className="panel">
        <h2>Today’s trips</h2>
        <TripTable rows={trips.data ?? []} />
      </div>
    </>
  );
}

function Stat({ n, l }: { n: number; l: string }) {
  return <div className="card"><div className="n">{n}</div><div className="l">{l}</div></div>;
}
