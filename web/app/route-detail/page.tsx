'use client';
import Link from 'next/link';
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
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [assign, setAssign] = useState({ studentId: '', routeStopId: '' });

  useEffect(() => {
    if (route.data) {
      setRows(route.data.stops.map((s: any) => ({ stopId: s.stopId, scheduledTime: s.scheduledTime })));
      setDirty(false);
    }
  }, [route.data]);

  if (!id) return <p>Missing route.</p>;
  const r = route.data;
  if (!r) return <><ErrorNote error={route.error} /><p className="muted">Loading…</p></>;

  const stopName = (sid: string) => allStops.data?.find((s: any) => s.id === sid)?.name ?? '…';
  const unused = (allStops.data ?? []).filter((s: any) => !rows.some((x) => x.stopId === s.id));
  const change = (next: Row[]) => { setRows(next); setDirty(true); };
  const assignedIds = new Set(r.students.map((s: any) => s.studentId));
  const available = (students.data ?? []).filter((s: any) => s.schoolId === r.schoolId && s.status === 'ACTIVE' && !assignedIds.has(s.id));

  async function run(fn: () => Promise<unknown>, ok: string) {
    setError(null);
    setNote(null);
    try {
      await fn();
      setNote(ok);
      route.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      <div className="pagehead">
        <div>
          <Link href="/routes/" className="small">← All routes</Link>
          <h1>{r.name}</h1>
          <p className="sub">{r.direction === 'MORNING' ? 'Morning pickup' : 'Afternoon drop-off'} · {r.stops.length} stops · {r.students.length} children</p>
        </div>
      </div>
      {r.capacityWarning && <div className="alert warn">More children than seats: {r.capacityWarning}</div>}
      <ErrorNote error={error} />
      {note && <div className="alert good">{note}</div>}

      <div className="grid two">
        <div className="panel">
          <h2>1. Stops in order</h2>
          {rows.length === 0 && <p className="muted">No stops yet. Add the first stop below.</p>}
          <ul className="stoplist">
            {rows.map((row, i) => (
              <li key={row.stopId}>
                <div className="seq">{i + 1}</div>
                <div className="row" style={{ gap: 10 }}>
                  <b style={{ flex: 1 }}>{stopName(row.stopId)}</b>
                  <input type="time" value={row.scheduledTime} style={{ width: 115 }} aria-label="Time"
                    onChange={(e) => change(rows.map((x, j) => (j === i ? { ...x, scheduledTime: e.target.value } : x)))} />
                </div>
                <div className="row" style={{ gap: 0 }}>
                  <button className="icon" disabled={i === 0} title="Move up" onClick={() => { const n = [...rows]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; change(n); }}>↑</button>
                  <button className="icon" disabled={i === rows.length - 1} title="Move down" onClick={() => { const n = [...rows]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; change(n); }}>↓</button>
                  <button className="icon" title="Remove" onClick={() => change(rows.filter((_, j) => j !== i))}>✕</button>
                </div>
              </li>
            ))}
          </ul>
          <div className="row" style={{ marginTop: 12 }}>
            <select value="" style={{ flex: 1 }} onChange={(e) => e.target.value && change([...rows, { stopId: e.target.value, scheduledTime: r.direction === 'MORNING' ? '07:30' : '14:30' }])}>
              <option value="">+ Add a stop…</option>
              {unused.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button className="primary" disabled={!dirty} onClick={() => run(() => api(`/admin/routes/${id}/stops`, { method: 'PUT', body: { stops: rows } }), 'Stops saved.')}>
              Save stops
            </button>
          </div>
          {!unused.length && !(allStops.data ?? []).length && <p className="hint">No stops exist yet. <Link href="/stops/">Add stops</Link> first.</p>}
        </div>

        <div className="panel">
          <h2>Map</h2>
          <Map
            tall
            points={[
              ...r.stops.map((s: any) => ({ id: s.routeStopId, lat: s.lat, lng: s.lng, kind: 'stop' as const, text: String(s.sequence), label: `${s.sequence}. ${s.name} — ${s.scheduledTime}` })),
              ...(r.school?.lat != null ? [{ id: 'school', lat: r.school.lat, lng: r.school.lng, kind: 'school' as const, label: r.school.name }] : []),
            ]}
            path={r.path}
            line={r.stops.map((s: any) => [s.lat, s.lng])}
          />
          <p className="hint">{r.path?.length > 1 ? 'Blue line = the road the bus takes.' : r.stops.length > 1 ? 'Dashed line: the road route could not be worked out, so stops are joined directly.' : 'Add at least two stops to see the route.'}</p>
        </div>
      </div>

      <div className="panel">
        <h2>2. Children on this route</h2>
        {r.stops.length === 0 ? <p className="muted">Save the stops first, then add children.</p> : (
          <>
            <div className="row" style={{ marginBottom: 14 }}>
              <select value={assign.studentId} onChange={(e) => setAssign({ ...assign, studentId: e.target.value })} style={{ width: 240 }}>
                <option value="">Choose a child…</option>
                {available.map((s: any) => <option key={s.id} value={s.id}>{s.name}{s.className ? ` (Class ${s.className})` : ''}</option>)}
              </select>
              <select value={assign.routeStopId} onChange={(e) => setAssign({ ...assign, routeStopId: e.target.value })} style={{ width: 240 }}>
                <option value="">at stop…</option>
                {r.stops.map((s: any) => <option key={s.routeStopId} value={s.routeStopId}>{s.sequence}. {s.name}</option>)}
              </select>
              <button className="primary" disabled={!assign.studentId || !assign.routeStopId}
                onClick={() => run(async () => { await api(`/admin/routes/${id}/assignments`, { method: 'PUT', body: { assignments: [assign] } }); setAssign({ studentId: '', routeStopId: '' }); }, 'Child added to the route.')}>
                Add child
              </button>
            </div>
            <table>
              <thead><tr><th>Stop</th><th>Children</th></tr></thead>
              <tbody>
                {r.stops.map((s: any) => (
                  <tr key={s.routeStopId}>
                    <td style={{ width: '40%' }}><b>{s.sequence}. {s.name}</b><div className="sub2">{s.scheduledTime}</div></td>
                    <td>
                      <div className="chips">
                        {r.students.filter((k: any) => k.routeStopId === s.routeStopId).map((k: any) => (
                          <span key={k.studentId} className="chip">{k.name}
                            <button title="Remove from route" onClick={() => run(() => api(`/admin/routes/${id}/assignments/${k.studentId}`, { method: 'DELETE' }), `${k.name} removed from this route.`)}>✕</button>
                          </span>
                        ))}
                        {!r.students.some((k: any) => k.routeStopId === s.routeStopId) && <span className="muted small">—</span>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </>
  );
}
