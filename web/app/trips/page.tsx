'use client';
import { useState } from 'react';
import { TripTable } from '@/components/TripTable';
import { ErrorNote, Shell } from '@/components/ui';
import { api, todayIST, useApi } from '@/lib/api';

export default function Trips() {
  return <Shell><Body /></Shell>;
}

function Body() {
  const [date, setDate] = useState(todayIST());
  const trips = useApi(`/admin/trips?date=${date}`, 10000);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setError(null);
    try {
      const res = await api('/admin/trips/generate', { method: 'POST', body: { date } });
      setNote(`${res.created} new trip(s). ${res.skippedHoliday ? `${res.skippedHoliday} skipped for a holiday. ` : ''}${res.skippedIncomplete ? `${res.skippedIncomplete} route(s) need a bus and driver.` : ''}`);
      trips.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      <h1>Trips</h1>
      <p className="sub">Trips are created every night for the next day. You can also create them here.</p>
      <div className="panel">
        <div className="row" style={{ marginBottom: 12 }}>
          <label style={{ width: 180 }}>Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <button onClick={generate} style={{ alignSelf: 'end' }}>Create trips for this date</button>
        </div>
        {note && <div className="alert good">{note}</div>}
        <ErrorNote error={error ?? trips.error} />
        <TripTable rows={trips.data ?? []} />
      </div>
    </>
  );
}
