'use client';
import Link from 'next/link';
import { CrudPage, daysText } from '@/components/Crud';
import { Shell } from '@/components/ui';
import { useApi } from '@/lib/api';

export default function Routes() {
  return <Shell><Body /></Shell>;
}

function Body() {
  const schools = useApi('/admin/schools');
  const buses = useApi('/admin/buses');
  const staff = useApi('/admin/staff');
  const opt = (list: any[] | null, label: (x: any) => string, filter: (x: any) => boolean = () => true) =>
    (list ?? []).filter(filter).map((x) => ({ value: x.id, label: label(x) }));
  const name = (list: any[] | null, id: string | null, key = 'name') => (id && list?.find((x) => x.id === id)?.[key]) || '—';

  return (
    <CrudPage
      title="Routes"
      subtitle="Make one route for the morning pickup and one for the afternoon drop-off. Trips are then created automatically on the days you choose."
      noun="Route"
      listPath="/admin/routes"
      search={(r) => r.name}
      fields={[
        { key: 'name', label: 'Route name', required: true, placeholder: 'e.g. Route 3 — Morning' },
        { key: 'direction', label: 'Trip', type: 'select', required: true, only: 'add', options: [{ value: 'MORNING', label: 'Morning pickup (home → school)' }, { value: 'AFTERNOON', label: 'Afternoon drop-off (school → home)' }] },
        { key: 'schoolId', label: 'School', type: 'select', required: true, options: opt(schools.data, (s) => s.name) },
        { key: 'days', label: 'Runs on', type: 'days', hint: 'Trips are created automatically on these days. Mark holidays on the Trips page.' },
        { key: 'busId', label: 'Bus', type: 'select', options: opt(buses.data, (b) => `${b.registrationNumber}${b.fleetNumber ? ` (${b.fleetNumber})` : ''}`) },
        { key: 'driverId', label: 'Driver', type: 'select', options: opt(staff.data, (u) => u.name, (u) => u.role === 'DRIVER' && u.active) },
        { key: 'attendantId', label: 'Attendant', type: 'select', options: opt(staff.data, (u) => u.name, (u) => u.role === 'ATTENDANT' && u.active) },
      ]}
      toForm={(r) => ({ days: r.days, name: r.name, direction: r.direction, schoolId: r.schoolId, busId: r.busId ?? '', driverId: r.driverId ?? '', attendantId: r.attendantId ?? '' })}
      toBody={(v, isEdit) => {
        const body: Record<string, any> = { ...v, days: v.days ?? [1, 2, 3, 4, 5, 6] };
        for (const k of ['busId', 'driverId', 'attendantId']) if (body[k] === '') delete body[k];
        if (isEdit) delete body.direction;
        return body;
      }}
      editPath={(r) => `/admin/routes/${r.id}`}
      deletePath={(r) => `/admin/routes/${r.id}`}
      columns={[
        { label: 'Route', render: (r) => <><Link className="name" href={`/route-detail/?id=${r.id}`}>{r.name}</Link><div className="sub2">{r.direction === 'MORNING' ? 'Morning pickup' : 'Afternoon drop-off'} · {name(schools.data, r.schoolId)}</div></> },
        { label: 'Runs on', render: (r) => daysText(r.days) },
        { label: 'Bus', render: (r) => name(buses.data, r.busId, 'registrationNumber') },
        { label: 'Driver', render: (r) => name(staff.data, r.driverId) },
        { label: 'Attendant', render: (r) => name(staff.data, r.attendantId) },
      ]}
      extraActions={(r) => <Link className="link-btn" href={`/route-detail/?id=${r.id}`}>Stops & children</Link>}
    />
  );
}
