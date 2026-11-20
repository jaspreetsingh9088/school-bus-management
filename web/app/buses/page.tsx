'use client';
import { CrudPage } from '@/components/Crud';
import { Pill, Shell } from '@/components/ui';

export default function Buses() {
  return <Shell><Body /></Shell>;
}

const soon = (d?: string | null) => !!d && new Date(d).getTime() - Date.now() < 30 * 86_400_000;
const docs = (b: any) => [['Insurance', b.insuranceExpiry], ['Fitness', b.fitnessExpiry], ['Permit', b.permitExpiry]] as [string, string | null][];

function Body() {
  return (
    <CrudPage
      title="Buses"
      noun="Bus"
      listPath="/admin/buses"
      search={(b) => `${b.registrationNumber} ${b.fleetNumber ?? ''}`}
      fields={[
        { key: 'registrationNumber', label: 'Registration number', required: true, placeholder: 'PB10AB1234' },
        { key: 'fleetNumber', label: 'Bus name or number', placeholder: 'e.g. Bus 7' },
        { key: 'capacity', label: 'Seats', type: 'number', required: true },
        { key: 'insuranceExpiry', label: 'Insurance valid until', type: 'date' },
        { key: 'fitnessExpiry', label: 'Fitness certificate valid until', type: 'date' },
        { key: 'permitExpiry', label: 'Permit valid until', type: 'date' },
        { key: 'status', label: 'Status', type: 'select', only: 'edit', options: [{ value: 'ACTIVE', label: 'Active' }, { value: 'MAINTENANCE', label: 'In maintenance' }, { value: 'INACTIVE', label: 'Not in use' }] },
      ]}
      toForm={(b) => ({ registrationNumber: b.registrationNumber, fleetNumber: b.fleetNumber ?? '', capacity: b.capacity, insuranceExpiry: b.insuranceExpiry ?? '', fitnessExpiry: b.fitnessExpiry ?? '', permitExpiry: b.permitExpiry ?? '', status: b.status })}
      toBody={(v) => {
        const body: Record<string, any> = { ...v, capacity: Number(v.capacity) };
        for (const k of ['insuranceExpiry', 'fitnessExpiry', 'permitExpiry', 'fleetNumber']) if (body[k] === '') delete body[k];
        return body;
      }}
      editPath={(b) => `/admin/buses/${b.id}`}
      deletePath={(b) => `/admin/buses/${b.id}`}
      columns={[
        { label: 'Bus', render: (b) => <><div className="name">{b.registrationNumber}</div><div className="sub2">{b.fleetNumber ?? ''}</div></> },
        { label: 'Seats', render: (b) => b.capacity },
        {
          label: 'Documents',
          render: (b) => {
            const due = docs(b).filter(([, d]) => soon(d));
            return due.length ? <span className="pill bad">{due.map(([n]) => n).join(', ')} due</span> : <span className="muted small">OK</span>;
          },
        },
        { label: 'Status', render: (b) => <Pill status={b.status} /> },
      ]}
    />
  );
}
