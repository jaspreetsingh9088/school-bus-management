'use client';
import Link from 'next/link';
import { useState } from 'react';
import { api, timeAgo } from '@/lib/api';
import { Confirm } from './Crud';
import { Pill } from './ui';

type Action = { kind: 'stop' | 'delete'; trip: any; name: string };

/** Trips with Open, Stop (while running) and Delete (when not running). */
export function TripTable({ rows, onChanged }: { rows: any[]; onChanged?: () => void }) {
  const [action, setAction] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!action) return;
    setBusy(true);
    setError(null);
    try {
      if (action.kind === 'stop') await api(`/admin/trips/${action.trip.id}/cancel`, { method: 'POST' });
      else await api(`/admin/trips/${action.trip.id}`, { method: 'DELETE' });
      onChanged?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setAction(null);
    }
  }

  if (!rows.length) return <p className="empty">No trips for this day. Use “Create trips”, or check that each route has a bus and driver.</p>;
  return (
    <>
      {error && <div className="alert bad">{error}</div>}
      <table>
        <thead><tr><th>Route</th><th>Bus</th><th>Trip</th><th>Status</th><th>Last GPS</th><th className="actions" /></tr></thead>
        <tbody>
          {rows.map(({ trip, routeName, busNumber }) => (
            <tr key={trip.id}>
              <td><Link className="name" href={`/trip/?id=${trip.id}`}>{routeName}</Link></td>
              <td>{busNumber}</td>
              <td>{trip.direction === 'MORNING' ? 'Morning pickup' : 'Afternoon drop-off'}</td>
              <td><Pill status={trip.status} /></td>
              <td className="muted">{trip.status === 'IN_PROGRESS' ? timeAgo(trip.lastPositionAt) : '—'}</td>
              <td className="actions">
                <Link className="link-btn" href={`/trip/?id=${trip.id}`}>Open</Link>
                {trip.status === 'IN_PROGRESS' || trip.status === 'SCHEDULED' ? (
                  <button className="link danger" onClick={() => setAction({ kind: trip.status === 'IN_PROGRESS' ? 'stop' : 'delete', trip, name: routeName })}>
                    {trip.status === 'IN_PROGRESS' ? 'Stop' : 'Delete'}
                  </button>
                ) : (
                  <button className="link danger" onClick={() => setAction({ kind: 'delete', trip, name: routeName })}>Delete</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {action && (
        <Confirm
          text={action.kind === 'stop' ? `Stop the trip “${action.name}”?` : `Delete the trip “${action.name}”?`}
          detail={action.kind === 'stop'
            ? 'The driver’s app stops sharing location and parents can no longer track this bus. You can delete the trip afterwards.'
            : 'This also deletes the trip’s boarding and GPS records. Use this for test trips.'}
          yesLabel={action.kind === 'stop' ? 'Stop trip' : 'Delete'}
          onYes={run}
          onNo={() => setAction(null)}
          busy={busy}
        />
      )}
    </>
  );
}
