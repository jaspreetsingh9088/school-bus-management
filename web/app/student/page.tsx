'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { PayModal } from '@/components/PayModal';
import { ErrorNote, Pill, Shell } from '@/components/ui';
import { api, inr, STATUS_LABEL, todayIST, useApi } from '@/lib/api';

export default function StudentPage() {
  return <Shell><Suspense><Body /></Suspense></Shell>;
}

const minus30 = () => {
  const d = new Date(`${todayIST()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 30);
  return d.toISOString().slice(0, 10);
};

function Body() {
  const id = useSearchParams().get('id');
  const student = useApi(id ? `/admin/students/${id}` : null);
  const fees = useApi(id ? `/admin/students/${id}/fees` : null);
  const history = useApi(id ? `/admin/students/${id}/history?from=${minus30()}&to=${todayIST()}` : null);
  const schools = useApi('/admin/schools');
  const [tab, setTab] = useState<'info' | 'fees' | 'trips'>('info');
  const [paying, setPaying] = useState<any | null>(null);

  if (!id) return <p>Missing student.</p>;
  const s = student.data;
  if (!s) return <><ErrorNote error={student.error} /><p className="muted">Loading…</p></>;
  const school = schools.data?.find((x: any) => x.id === s.schoolId)?.name ?? '';
  const bills: any[] = fees.data ?? [];
  const due = bills.reduce((a, b) => a + b.dueRupees, 0);
  const trips: any[] = history.data ?? [];
  const rode = trips.filter((t) => !['ABSENT', 'NO_SHOW', 'SCHEDULED'].includes(t.status)).length;

  return (
    <>
      <Link href="/students/" className="small">← All students</Link>
      <div className="profile">
        <div className="avatar">{s.name.slice(0, 1)}</div>
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0 }}>{s.name}</h1>
          <p className="sub" style={{ margin: '2px 0 0' }}>{school}{s.className ? ` · Class ${s.className}${s.section ? ` ${s.section}` : ''}` : ''} · <Pill status={s.status} /></p>
        </div>
        <div className="mini"><b>{s.monthlyFeePaise ? inr(s.monthlyFeePaise / 100) : '—'}</b><span>Monthly fee</span></div>
        <div className={`mini${due > 0 ? ' bad' : ''}`}><b>{inr(due)}</b><span>Fee pending</span></div>
        <div className="mini"><b>{rode}</b><span>Trips in 30 days</span></div>
      </div>

      <div className="tabs">
        {([['info', 'Details'], ['fees', 'Fees'], ['trips', 'Trip history']] as const).map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === 'info' && (
        <div className="grid two">
          <div className="panel">
            <h2>Student</h2>
            <dl className="facts">
              <dt>Student ID</dt><dd>{s.registrationNumber ?? '—'}</dd>
              <dt>Emergency phone</dt><dd>{s.emergencyContactPhone ?? '—'}</dd>
              <dt>Note for driver</dt><dd>{s.specialInstructions ?? '—'}</dd>
              <dt>Goes home alone</dt><dd>{s.mayGoHomeAlone ? 'Allowed by parent' : 'No — must be handed to an adult'}</dd>
              <dt>Parent code</dt><dd><code>{s.activationCode ?? '—'}</code></dd>
            </dl>
            <h2 style={{ marginTop: 18 }}>Bus</h2>
            {s.assignments.length === 0 && <p className="muted">Not on any route yet. Add the student on the Routes page.</p>}
            {s.assignments.map((a: any) => (
              <div key={a.direction} className="attention">
                <span><b>{a.direction === 'MORNING' ? 'Morning' : 'Afternoon'}</b> · {a.routeName}<div className="sub2">{a.stopName} at {a.time}</div></span>
                <Link href={`/route-detail/?id=${a.routeId}`}>Open route</Link>
              </div>
            ))}
          </div>
          <div className="panel">
            <h2>Parents</h2>
            {s.parents.length === 0 && <p className="muted">No parent linked. Parents can add the child in the app with the code above.</p>}
            {s.parents.map((p: any) => (
              <div key={p.parentId} className="attention"><span><b>{p.name}</b><div className="sub2">{p.relation.toLowerCase()}</div></span><a href={`tel:${p.phone}`}>{p.phone}</a></div>
            ))}
            <h2 style={{ marginTop: 18 }}>Allowed to collect</h2>
            {s.authorizedAdults.length === 0 && <p className="muted">Only the parents.</p>}
            {s.authorizedAdults.map((a: any) => (
              <div key={a.id} className="attention">
                <span><b>{a.name}</b> ({a.relation}){a.phone ? ` · ${a.phone}` : ''}</span>
                {a.approved ? <span className="pill good">Approved</span> : (
                  <button className="primary" onClick={async () => { await api(`/admin/students/${s.id}/authorized-adults/${a.id}/approve`, { method: 'POST' }); student.reload(); }}>Approve</button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'fees' && (
        <div className="panel flush">
          <div className="toolbar between"><b>Monthly bills</b>{!s.monthlyFeePaise && <span className="muted small">No monthly fee set. Edit the student on the Students page to add one.</span>}</div>
          {bills.length === 0 ? <p className="empty">No bills yet.</p> : (
            <table>
              <thead><tr><th>Month</th><th>Fee</th><th>Paid</th><th>Pending</th><th>Status</th><th>Payments</th><th className="actions" /></tr></thead>
              <tbody>
                {bills.map((b) => (
                  <tr key={b.invoiceId}>
                    <td><b>{new Date(`${b.month}-01T00:00:00Z`).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</b><div className="sub2">due {b.dueDate}</div></td>
                    <td>{inr(b.feeRupees)}</td>
                    <td>{inr(b.paidRupees)}</td>
                    <td>{inr(b.dueRupees)}</td>
                    <td><Pill status={b.status} /></td>
                    <td className="small">{b.payments.map((p: any, i: number) => <div key={i}>{inr(p.amountRupees)} · {p.method.toLowerCase()} · {new Date(p.paidAt).toLocaleDateString('en-IN')}</div>)}</td>
                    <td className="actions">
                      {b.dueRupees > 0 && <button className="link" onClick={() => setPaying({ ...b, name: s.name })}>Mark paid</button>}
                      {b.paidRupees > 0 && <button className="link danger" onClick={async () => { await api(`/admin/fees/${b.invoiceId}/pending`, { method: 'POST' }); fees.reload(); }}>Undo</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'trips' && (
        <div className="panel flush">
          <div className="toolbar"><b>Last 30 days</b></div>
          {trips.length === 0 ? <p className="empty">No trips in the last 30 days.</p> : (
            <table>
              <thead><tr><th>Date</th><th>Trip</th><th>Status</th><th className="actions" /></tr></thead>
              <tbody>
                {[...trips].reverse().map((t) => (
                  <tr key={t.tripId}>
                    <td>{new Date(`${t.date}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}</td>
                    <td>{t.direction === 'MORNING' ? 'Morning pickup' : 'Afternoon drop-off'}</td>
                    <td><Pill status={t.status} /> <span className="muted small">{STATUS_LABEL[t.status] ? '' : t.status}</span></td>
                    <td className="actions"><Link href={`/trip/?id=${t.tripId}`}>Open</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {paying && <PayModal bill={paying} onClose={() => setPaying(null)} onDone={fees.reload} />}
    </>
  );
}
