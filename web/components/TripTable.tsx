'use client';
import Link from 'next/link';
import { timeAgo } from '@/lib/api';
import { Pill } from './ui';

export function TripTable({ rows }: { rows: any[] }) {
  if (!rows.length) return <p className="empty">No trips. Use “Create today’s trips”, or check that routes have a bus and driver.</p>;
  return (
    <table>
      <thead><tr><th>Route</th><th>Bus</th><th>Trip</th><th>Status</th><th>Last GPS</th><th /></tr></thead>
      <tbody>
        {rows.map(({ trip, routeName, busNumber }) => (
          <tr key={trip.id}>
            <td>{routeName}</td>
            <td>{busNumber}</td>
            <td>{trip.direction === 'MORNING' ? 'Morning pickup' : 'Afternoon drop-off'}</td>
            <td><Pill status={trip.status} /></td>
            <td className="muted">{trip.status === 'IN_PROGRESS' ? timeAgo(trip.lastPositionAt) : '—'}</td>
            <td><Link href={`/trip/?id=${trip.id}`}>Open</Link></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
