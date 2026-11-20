'use client';
import Link from 'next/link';
import { CrudPage } from '@/components/Crud';
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
      subtitle="Make one route for the morning pickup and one for the afternoon drop-off. Click a route to set its stops and children."
      noun="Route"
      listPath="/admin/routes"
      search={(r) => r.name}
      fields={[
        { key: 'name', label: 'Route name', required: true, placeholder: 'e.g. Route 3 — Morning' },
        { key: 'direction', label: 'Trip', type: 'select', required: true, only: 'add', options: [{ value: 'MORNING', label: 'Morning pickup (home → school)' }, { value: 'AFTERNOON', label: 'Afternoon drop-off (school → home)' }] },
        { key: 'schoolId', label: 'School', type: 'select', required: true, options: opt(schools.data, (s) => s.name) },
        { key: 'busId', label: 'Bus', type: 'select', options: opt(buses.data, (b) => `${b.registrationNumber}${b.fleetNumber ? ` (${b.fleetNumber})` : ''}`) },
        { key: 'driverId', label: 'Driver', type: 'select', options: opt(staff.data, (u) => u.name, (u) => u.role === 'DRIVER' && u.active) },
        { key: 'attendantId', label: 'Attendant', type: 'select', options: opt(staff.data, (u) => u.name, (u) => u.role === 'ATTENDANT' && u.active) },
      ]}
      toForm={(r) => ({ name: r.name, direction: r.direction, schoolId: r.schoolId, busId: r.busId ?? '', driverId: r.driverId ?? '', attendantId: r.attendantId ?? '' })}
      toBody={(v, isEdit) => {
        const body: Record<string, any> = { ...v };
        for (const k of ['busId', 'driverId', 'attendantId']) if (body[k] === '') delete body[k];
        if (isEdit) delete body.direction;
        return body;
      }}
      editPath={(r) => `/admin/routes/${r.id}`}
      deletePath={(r) => `/admin/routes/${r.id}`}
      columns={[
        { label: 'Route', render: (r) => <><Link className="name" href={`/route-detail/?id=${r.id}`}>{r.name}</Link><div className="sub2">{r.direction === 'MORNING' ? 'Morning pickup' : 'Afternoon drop-off'} · {name(schools.data, r.schoolId)}</div></> },
        { label: 'Bus', render: (r) => name(buses.data, r.busId, 'registrationNumber') },
        { label: 'Driver', render: (r) => name(staff.data, r.driverId) },
        { label: 'Attendant', render: (r) => name(staff.data, r.attendantId) },
      ]}
      extraActions={(r) => <Link className="link-btn" href={`/route-detail/?id=${r.id}`}>Stops & children</Link>}
    />
  );
}
