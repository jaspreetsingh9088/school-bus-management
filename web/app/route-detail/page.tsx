'use client';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { ErrorNote, Map, Shell } from '@/components/ui';
import { api, useApi } from '@/lib/api';

export default function RoutePage() {
  return <Shell><Suspense><Body /></Suspense></Shell>;
}

interface Row { stopId: string; scheduledTime: string }

function Body() {
  const id = useSearchParams().get('id');
  const route = useApi(id ? `/admin/routes/${id}` : null);
  const allStops = useApi('/admin/stops');
  const students = useApi('/admin/students');
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [assign, setAssign] = useState({ studentId: '', routeStopId: '' });

  useEffect(() => {
    if (route.data) setRows(route.data.stops.map((s: any) => ({ stopId: s.stopId, scheduledTime: s.scheduledTime })));
  }, [route.data]);

  if (!id) return <p>Missing route id.</p>;
  const r = route.data;
  if (!r) return <><ErrorNote error={route.error} /><p className="muted">Loading…</p></>;
  const stopName = (sid: string) => allStops.data?.find((s: any) => s.id === sid)?.name ?? '…';
  const unused = (allStops.data ?? []).filter((s: any) => !rows.some((x) => x.stopId === s.id));

  function move(i: number, d: number) {
    const next = [...rows];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x);
    setRows(next);
  }

  async function save() {
    setError(null);
    setNote(null);
    try {
      await api(`/admin/routes/${id}/stops`, { method: 'PUT', body: { stops: rows } });
      setNote('Stops saved.');
      route.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function addAssignment() {
    setError(null);
    try {
      await api(`/admin/routes/${id}/assignments`, { method: 'PUT', body: { assignments: [assign] } });
      setAssign({ studentId: '', routeStopId: '' });
      route.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const schoolStudents = (students.data ?? []).filter((s: any) => s.schoolId === r.schoolId && s.status === 'ACTIVE');
  const points = r.stops.map((s: any) => ({ id: s.routeStopId, lat: s.lat, lng: s.lng, kind: 'stop' as const, text: String(s.sequence), label: `${s.sequence}. ${s.name} — ${s.scheduledTime}` }));

  return (
    <>
      <h1>{r.name}</h1>
      <p className="sub">{r.direction === 'MORNING' ? 'Morning pickup' : 'Afternoon drop-off'} · {r.students.length} children</p>
      {r.capacityWarning && <div className="alert warn">More children than seats: {r.capacityWarning}</div>}
      <ErrorNote error={error} />
      {note && <div className="alert good">{note}</div>}

      <div className="grid two">
        <div className="panel">
          <h2>Map</h2>
          <Map points={points} line={r.stops.map((s: any) => [s.lat, s.lng])} />
        </div>
        <div className="panel">
          <h2>Stops in order</h2>
          <ul className="stoplist">
            {rows.map((row, i) => (
              <li key={row.stopId}>
                <div className="seq">{i + 1}</div>
                <div>
                  <b>{stopName(row.stopId)}</b>
                  <div className="row" style={{ marginTop: 4 }}>
                    <input type="time" value={row.scheduledTime} style={{ width: 120 }}
                      onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, scheduledTime: e.target.value } : x)))} />
                  </div>
                </div>
                <div className="row" style={{ gap: 4 }}>
                  <button disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                  <button disabled={i === rows.length - 1} onClick={() => move(i, 1)}>↓</button>
                  <button className="danger" onClick={() => setRows(rows.filter((_, j) => j !== i))}>✕</button>
                </div>
              </li>
            ))}
          </ul>
          <div className="row" style={{ marginTop: 10 }}>
            <select id="addstop" defaultValue="" style={{ flex: 1 }}
              onChange={(e) => { if (e.target.value) { setRows([...rows, { stopId: e.target.value, scheduledTime: '07:30' }]); e.target.value = ''; } }}>
              <option value="">+ Add a stop…</option>
              {unused.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button className="primary" onClick={save}>Save stops</button>
          </div>
        </div>
      </div>

      <div className="panel">
        <h2>Children on this route</h2>
        <div className="row" style={{ marginBottom: 12 }}>
          <select value={assign.studentId} onChange={(e) => setAssign({ ...assign, studentId: e.target.value })} style={{ width: 220 }}>
            <option value="">Choose student…</option>
            {schoolStudents.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select value={assign.routeStopId} onChange={(e) => setAssign({ ...assign, routeStopId: e.target.value })} style={{ width: 220 }}>
            <option value="">at stop…</option>
            {r.stops.map((s: any) => <option key={s.routeStopId} value={s.routeStopId}>{s.sequence}. {s.name}</option>)}
          </select>
          <button className="primary" disabled={!assign.studentId || !assign.routeStopId} onClick={addAssignment}>Assign</button>
        </div>
        <table>
          <thead><tr><th>Child</th><th>Stop</th></tr></thead>
          <tbody>
            {r.students.map((s: any) => (
              <tr key={s.studentId}><td>{s.name}</td><td>{r.stops.find((x: any) => x.routeStopId === s.routeStopId)?.name}</td></tr>
            ))}
          </tbody>
        </table>
        {!r.students.length && <p className="empty">No children assigned yet. Save the stops first.</p>}
      </div>
    </>
  );
}
