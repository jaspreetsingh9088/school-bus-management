'use client';
import { useState } from 'react';
import { Confirm } from '@/components/Crud';
import { TripTable } from '@/components/TripTable';
import { ErrorNote, Shell } from '@/components/ui';
import { api, todayIST, useApi } from '@/lib/api';

export default function Trips() {
  return <Shell><Body /></Shell>;
}

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** Monday of the week containing `date`. */
const monday = (date: string) => {
  const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, wd === 0 ? -6 : 1 - wd);
};

function Body() {
  const today = todayIST();
  const [date, setDate] = useState(today);
  const trips = useApi(`/admin/trips?date=${date}`, 10000);
  const holidays = useApi('/admin/holidays');
  const [error, setError] = useState<string | null>(null);
  const [holidayName, setHolidayName] = useState('');
  const [removing, setRemoving] = useState<any | null>(null);
  const week = [...Array(7).keys()].map((i) => addDays(monday(date), i));
  const holidayOn = (d: string) => (holidays.data ?? []).find((h: any) => h.date === d);
  const h = holidayOn(date);
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  const upcoming = (holidays.data ?? []).filter((x: any) => x.date >= today).sort((a: any, b: any) => a.date.localeCompare(b.date));

  async function addHoliday() {
    setError(null);
    try {
      await api('/admin/holidays', { method: 'POST', body: { date, name: holidayName.trim() || 'Holiday' } });
      setHolidayName('');
      holidays.reload();
      trips.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Trips</h1>
          <p className="sub">Trips are created automatically for every route on its school days. Pick a day to see them.</p>
        </div>
      </div>
      <ErrorNote error={error ?? trips.error} />

      <div className="panel">
        <div className="weekbar">
          <button className="icon" onClick={() => setDate(addDays(date, -7))} aria-label="Previous week">‹</button>
          {week.map((d) => {
            const dt = new Date(`${d}T00:00:00Z`);
            return (
              <button key={d} className={`wday${d === date ? ' on' : ''}${d === today ? ' today' : ''}${holidayOn(d) ? ' off' : ''}`} onClick={() => setDate(d)}>
                <span>{DAY[dt.getUTCDay()]}</span>
                <b>{dt.getUTCDate()}</b>
                <small>{holidayOn(d) ? 'Holiday' : d === today ? 'Today' : dt.toLocaleString('en-IN', { month: 'short', timeZone: 'UTC' })}</small>
              </button>
            );
          })}
          <button className="icon" onClick={() => setDate(addDays(date, 7))} aria-label="Next week">›</button>
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} style={{ width: 160, marginLeft: 'auto' }} />
        </div>
      </div>

      {h ? (
        <div className="alert warn row between">
          <span><b>{h.name}</b> — no buses run on this day.</span>
          <button onClick={() => setRemoving(h)}>Remove holiday</button>
        </div>
      ) : (
        <div className="panel flush">
          <div className="toolbar between">
            <b>{new Date(`${date}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })}</b>
            {date >= today && (
              <span className="row">
                <input placeholder="Holiday name, e.g. Diwali" value={holidayName} onChange={(e) => setHolidayName(e.target.value)} style={{ width: 210 }} />
                <button onClick={addHoliday}>Mark as holiday</button>
              </span>
            )}
          </div>
          {weekday === 0 && !(trips.data ?? []).length
            ? <p className="empty">Sunday — no routes run. (You can add Sunday to a route on the Routes page.)</p>
            : <div style={{ padding: '0 8px' }}><TripTable rows={trips.data ?? []} onChanged={trips.reload} /></div>}
        </div>
      )}

      {upcoming.length > 0 && (
        <div className="panel">
          <h2>Upcoming holidays</h2>
          {upcoming.map((x: any) => (
            <div key={x.id} className="attention">
              <span><b>{new Date(`${x.date}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}</b> · {x.name}</span>
              <button className="link danger" onClick={() => setRemoving(x)}>Remove</button>
            </div>
          ))}
        </div>
      )}

      {removing && (
        <Confirm
          text={`Remove the holiday “${removing.name}”?`}
          detail="Buses will run on this day again and trips will be created automatically."
          yesLabel="Remove holiday"
          onNo={() => setRemoving(null)}
          onYes={async () => {
            await api(`/admin/holidays/${removing.id}`, { method: 'DELETE' });
            setRemoving(null);
            holidays.reload();
            trips.reload();
          }}
        />
      )}
    </>
  );
}
