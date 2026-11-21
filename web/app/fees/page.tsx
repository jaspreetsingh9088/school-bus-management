'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Modal } from '@/components/Crud';
import { PayModal } from '@/components/PayModal';
import { ErrorNote, Pill, Shell } from '@/components/ui';
import { api, downloadCsv, inr, todayIST, useApi } from '@/lib/api';

export default function Fees() {
  return <Shell><Body /></Shell>;
}

const monthName = (m: string, short = false) =>
  new Date(`${m}-01T00:00:00Z`).toLocaleString('en-IN', { month: short ? 'short' : 'long', year: short ? undefined : 'numeric', timeZone: 'UTC' });
const shift = (m: string, n: number) => {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

function Body() {
  const [month, setMonth] = useState(todayIST().slice(0, 7));
  const view = useApi(`/admin/fees?month=${month}`);
  const [tab, setTab] = useState<'students' | 'class' | 'bus'>('students');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [paying, setPaying] = useState<any | null>(null);
  const [setting, setSetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const v = view.data;

  const rows = (v?.rows ?? []).filter((r: any) =>
    (!status || (status === 'UNPAID' ? r.status !== 'PAID' : r.status === status)) &&
    `${r.name} ${r.className ?? ''} ${r.bus ?? ''} ${r.parent ?? ''}`.toLowerCase().includes(q.toLowerCase()));

  async function download(by: 'student' | 'class' | 'bus') {
    setError(null);
    try {
      await downloadCsv(`/admin/exports/fees.csv?month=${month}&by=${by}`, `fees-${month}-${by}-wise.csv`);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const max = Math.max(1, ...(v?.chart ?? []).map((c: any) => c.billed));

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Fees</h1>
          <p className="sub">Bills are made automatically every month for students with a monthly fee.</p>
        </div>
        <div className="row">
          <button onClick={() => setSetting(true)}>Set monthly fee</button>
          <div className="dropdown">
            <button className="primary">⬇ Download CSV</button>
            <div className="menu">
              <button onClick={() => download('student')}>Student-wise</button>
              <button onClick={() => download('class')}>Class-wise</button>
              <button onClick={() => download('bus')}>Bus-wise</button>
            </div>
          </div>
        </div>
      </div>
      <ErrorNote error={error ?? view.error} />

      <div className="panel">
        <div className="row between">
          <div className="row">
            <button className="icon" onClick={() => setMonth(shift(month, -1))} aria-label="Previous month">‹</button>
            <b style={{ fontSize: 18, minWidth: 150, textAlign: 'center' }}>{monthName(month)}</b>
            <button className="icon" onClick={() => setMonth(shift(month, 1))} aria-label="Next month">›</button>
          </div>
          <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} style={{ width: 170 }} />
        </div>
      </div>

      {v && (
        <>
          <div className="tiles">
            <div className="tile"><div className="n">{inr(v.totals.fee)}</div><div className="l">Total fee · {v.totals.students} students</div></div>
            <div className="tile good"><div className="n">{inr(v.totals.collected)}</div><div className="l">Collected · {v.totals.paidCount} fully paid</div></div>
            <div className="tile warn"><div className="n">{inr(v.totals.pending)}</div><div className="l">Pending</div></div>
            <div className={`tile${v.totals.overdueCount ? ' hot' : ''}`}><div className="n">{v.totals.overdueCount}</div><div className="l">Overdue (after the 10th)</div></div>
          </div>

          <div className="grid two">
            <div className="panel">
              <h2>Last 6 months</h2>
              <div className="chart">
                {v.chart.map((c: any) => (
                  <button key={c.month} className={`bar${c.month === month ? ' on' : ''}`} onClick={() => setMonth(c.month)} title={`${monthName(c.month)}: ${inr(c.collected)} of ${inr(c.billed)}`}>
                    <div className="col">
                      <div className="billed" style={{ height: `${(c.billed / max) * 100}%` }}>
                        <div className="got" style={{ height: c.billed ? `${(c.collected / c.billed) * 100}%` : 0 }} />
                      </div>
                    </div>
                    <small>{monthName(c.month, true)}</small>
                  </button>
                ))}
              </div>
              <div className="legend"><span><i className="sw got" /> Collected</span><span><i className="sw billed" /> Still pending</span></div>
            </div>
            <div className="panel">
              <h2>Collection this month</h2>
              <div className="ring" style={{ ['--p' as any]: v.totals.fee ? Math.round((v.totals.collected / v.totals.fee) * 100) : 0 }}>
                <b>{v.totals.fee ? Math.round((v.totals.collected / v.totals.fee) * 100) : 0}%</b>
                <span>collected</span>
              </div>
              <p className="muted small" style={{ textAlign: 'center' }}>{inr(v.totals.collected)} of {inr(v.totals.fee)}</p>
            </div>
          </div>

          <div className="tabs">
            {([['students', 'Students'], ['class', 'By class'], ['bus', 'By bus']] as const).map(([k, l]) => (
              <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
            ))}
          </div>

          {tab === 'students' ? (
            <div className="panel flush">
              <div className="toolbar">
                <input className="search" placeholder="Search student, class, bus, parent…" value={q} onChange={(e) => setQ(e.target.value)} />
                <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 170 }}>
                  <option value="">All</option>
                  <option value="UNPAID">Not fully paid</option>
                  <option value="PAID">Paid</option>
                  <option value="PARTLY_PAID">Partly paid</option>
                  <option value="PENDING">Pending</option>
                  <option value="OVERDUE">Overdue</option>
                </select>
                <span className="muted small">{rows.length} of {v.rows.length}</span>
              </div>
              {v.rows.length === 0 ? <p className="empty">No bills this month. Set a monthly fee for students first (“Set monthly fee”).</p> : (
                <table>
                  <thead><tr><th>Student</th><th>Bus</th><th>Parent</th><th>Fee</th><th>Paid</th><th>Pending</th><th>Status</th><th className="actions" /></tr></thead>
                  <tbody>
                    {rows.map((r: any) => (
                      <tr key={r.invoiceId}>
                        <td><Link className="name" href={`/student/?id=${r.studentId}`}>{r.name}</Link><div className="sub2">{r.className ? `Class ${r.className}${r.section ? ` ${r.section}` : ''}` : ''}</div></td>
                        <td>{r.bus ?? <span className="muted">—</span>}</td>
                        <td>{r.parent ?? <span className="muted">—</span>}<div className="sub2">{r.parentPhone ?? ''}</div></td>
                        <td>{inr(r.feeRupees)}</td>
                        <td>{inr(r.paidRupees)}{r.paidOn && <div className="sub2">{r.method?.toLowerCase()} · {r.paidOn}</div>}</td>
                        <td>{inr(r.dueRupees)}</td>
                        <td><Pill status={r.status} /></td>
                        <td className="actions">
                          {r.dueRupees > 0 && <button className="link" onClick={() => setPaying({ ...r, month: monthName(month) })}>Mark paid</button>}
                          {r.paidRupees > 0 && <button className="link danger" onClick={async () => { await api(`/admin/fees/${r.invoiceId}/pending`, { method: 'POST' }); view.reload(); }}>Mark pending</button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ) : (
            <div className="panel flush">
              <table>
                <thead><tr><th>{tab === 'class' ? 'Class' : 'Bus'}</th><th>Students</th><th>Fee</th><th>Collected</th><th>Pending</th><th>Paid</th><th>Overdue</th></tr></thead>
                <tbody>
                  {(tab === 'class' ? v.byClass : v.byBus).map((g: any) => (
                    <tr key={g.name}>
                      <td className="name">{g.name}</td>
                      <td>{g.students}</td>
                      <td>{inr(g.fee)}</td>
                      <td>{inr(g.collected)}</td>
                      <td>{inr(g.pending)}</td>
                      <td>{g.paidCount} of {g.students}</td>
                      <td>{g.overdueCount ? <span className="pill bad">{g.overdueCount}</span> : '0'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {paying && <PayModal bill={paying} onClose={() => setPaying(null)} onDone={view.reload} />}
      {setting && <SetFee onClose={() => setSetting(false)} onDone={view.reload} />}
    </>
  );
}

function SetFee({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const students = useApi('/admin/students');
  const routes = useApi('/admin/routes');
  const [who, setWho] = useState<'class' | 'route' | 'all'>('class');
  const [className, setClassName] = useState('');
  const [routeId, setRouteId] = useState('');
  const [amount, setAmount] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const classes = [...new Set((students.data ?? []).map((s: any) => s.className).filter(Boolean))].sort((a: any, b: any) => String(a).localeCompare(String(b), 'en', { numeric: true }));

  async function save() {
    setError(null);
    try {
      const body: Record<string, any> = { amount: Number(amount) };
      if (who === 'class') body.className = className;
      if (who === 'route') body.routeId = routeId;
      const res = await api('/admin/fees/set', { method: 'POST', body });
      setResult(`Monthly fee set for ${res.updated} student(s). This month’s unpaid bills now use the new amount.`);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Modal title="Set monthly bus fee" onClose={onClose}>
      <div className="stack">
        {error && <div className="alert bad">{error}</div>}
        {result && <div className="alert good">{result}</div>}
        <div className="field"><span className="lbl">For</span>
          <div className="days">
            {([['class', 'A class'], ['route', 'A route'], ['all', 'All students']] as const).map(([k, l]) => (
              <button type="button" key={k} className={`day${who === k ? ' on' : ''}`} onClick={() => setWho(k)}>{l}</button>
            ))}
          </div>
        </div>
        {who === 'class' && (
          <label className="field"><span className="lbl">Class</span>
            <select value={className} onChange={(e) => setClassName(e.target.value)}>
              <option value="">Choose…</option>
              {classes.map((c: any) => <option key={c} value={c}>Class {c}</option>)}
            </select>
          </label>
        )}
        {who === 'route' && (
          <label className="field"><span className="lbl">Route</span>
            <select value={routeId} onChange={(e) => setRouteId(e.target.value)}>
              <option value="">Choose…</option>
              {(routes.data ?? []).map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
        )}
        <label className="field"><span className="lbl">Monthly fee (₹)</span>
          <input type="number" min={0} placeholder="e.g. 1500" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <span className="hint">One student’s fee can also be changed on the Students page.</span>
        </label>
        <div className="row end">
          <button onClick={onClose}>Close</button>
          <button className="primary" disabled={amount === '' || (who === 'class' && !className) || (who === 'route' && !routeId)} onClick={save}>Save fee</button>
        </div>
      </div>
    </Modal>
  );
}
