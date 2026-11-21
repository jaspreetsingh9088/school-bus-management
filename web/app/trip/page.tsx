'use client';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { ErrorNote, Map, Pill, Shell } from '@/components/ui';
import { api, STATUS_LABEL, timeAgo, useApi } from '@/lib/api';

export default function TripPage() {
  return <Shell><Suspense><Body /></Suspense></Shell>;
}

const OVERRIDE_TO = ['SCHEDULED', 'ABSENT', 'BOARDED', 'NO_SHOW', 'AT_SCHOOL', 'HANDED_OVER', 'DROPPED_ALONE', 'HELD', 'RETURNED'];

function Body() {
  const id = useSearchParams().get('id');
  const sheet = useApi(id ? `/admin/trips/${id}` : null, 5000);
  const track = useApi(id ? `/admin/trips/${id}/track` : null, 15000);
  const [edit, setEdit] = useState<{ studentId: string; name: string } | null>(null);
  const [to, setTo] = useState('AT_SCHOOL');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!id) return <p>Missing trip id.</p>;
  const s = sheet.data;
  if (!s) return <><ErrorNote error={sheet.error} /><p className="muted">Loading…</p></>;
  const t = s.trip;
  const kids = s.stops.flatMap((st: any) => st.students);
  const count = (st: string) => kids.filter((k: any) => k.status === st).length;

  async function override() {
    if (!edit) return;
    setError(null);
    try {
      await api(`/admin/trips/${id}/students/${edit.studentId}/override`, { method: 'POST', body: { toStatus: to, note: reason } });
      setEdit(null);
      setReason('');
      sheet.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const points = [
    ...s.stops.map((st: any) => ({ id: st.routeStopId, lat: st.lat, lng: st.lng, kind: st.arrivedAt ? 'stop-done' as const : 'stop' as const, text: String(st.sequence), label: `${st.sequence}. ${st.name} (${st.scheduledTime})` })),
    ...(t.lastLat !== null ? [{ id: 'bus', lat: t.lastLat, lng: t.lastLng, kind: 'bus' as const, label: `Bus · ${Math.round(t.lastSpeedKmh ?? 0)} km/h · ${timeAgo(t.lastPositionAt)}` }] : []),
  ];

  return (
    <>
      <div className="row between">
        <div>
          <h1>{t.direction === 'MORNING' ? 'Morning pickup' : 'Afternoon drop-off'} · {t.date}</h1>
          <p className="sub">
            <Pill status={t.status} />{' '}
            {t.startedAt && <>Started {timeAgo(t.startedAt)} · </>}
            {t.status === 'IN_PROGRESS' && <>Last GPS {timeAgo(t.lastPositionAt)} · </>}
            Empty-bus check: {t.emptyBusCheckedAt ? <b style={{ color: 'var(--good)' }}>done</b> : 'not yet'}
          </p>
        </div>
      </div>

      <div className="grid cards">
        {['SCHEDULED', 'BOARDED', 'AT_SCHOOL', 'HANDED_OVER', 'ABSENT', 'NO_SHOW', 'HELD', 'RETURNED']
          .filter((st) => count(st) > 0 || ['SCHEDULED', 'BOARDED'].includes(st))
          .map((st) => <div className="card" key={st}><div className="n">{count(st)}</div><div className="l">{STATUS_LABEL[st]}</div></div>)}
      </div>

      <div className="grid two">
        <div className="panel">
          <h2>Map</h2>
          <Map
            tall
            points={[...points, ...(s.school?.lat != null ? [{ id: 'school', lat: s.school.lat, lng: s.school.lng, kind: 'school' as const, label: s.school.name }] : [])]}
            path={s.path}
            line={s.stops.map((st: any) => [st.lat, st.lng])}
            trail={(track.data ?? []).map((p: any) => [p.lat, p.lng])}
          />
          <p className="hint">Blue = planned road · Yellow = where the bus actually went</p>
        </div>
        <div className="panel">
          <h2>Stops and children</h2>
          <ErrorNote error={error} />
          {edit && (
            <div className="alert warn">
              <b>Correct status for {edit.name}</b>
              <div className="row" style={{ marginTop: 8 }}>
                <select value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 170 }}>
                  {OVERRIDE_TO.map((o) => <option key={o} value={o}>{STATUS_LABEL[o]}</option>)}
                </select>
                <input placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
                <button className="primary" disabled={!reason.trim()} onClick={override}>Save</button>
                <button onClick={() => setEdit(null)}>Cancel</button>
              </div>
            </div>
          )}
          <ul className="stoplist">
            {s.stops.map((st: any) => (
              <li key={st.routeStopId}>
                <div className={`seq${st.arrivedAt ? ' done' : ''}`}>{st.sequence}</div>
                <div>
                  <b>{st.name}</b> <span className="muted small">{st.scheduledTime}{st.arrivedAt ? ` · reached ${timeAgo(st.arrivedAt)}` : ''}</span>
                  <div className="kids">
                    {st.students.map((k: any) => (
                      <span key={k.studentId} className="row" style={{ gap: 4 }}>
                        <a href="#" onClick={(e) => { e.preventDefault(); setEdit({ studentId: k.studentId, name: k.name }); }} title="Correct status">{k.name}</a>
                        <Pill status={k.status} />
                      </span>
                    ))}
                    {!st.students.length && <span className="muted small">No children at this stop</span>}
                  </div>
                </div>
                <div />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}
