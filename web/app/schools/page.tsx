'use client';
import { CrudPage } from '@/components/Crud';
import { Shell } from '@/components/ui';

export default function Schools() {
  return <Shell><Body /></Shell>;
}

function Body() {
  return (
    <CrudPage
      title="Schools"
      noun="School"
      listPath="/admin/schools"
      wideForm
      search={(s) => `${s.name} ${s.address ?? ''}`}
      fields={[
        { key: 'name', label: 'School name', required: true },
        { key: 'address', label: 'Address' },
        { key: 'phone', label: 'Phone', type: 'tel' },
        { key: 'location', label: 'Location (used for “distance to school” in the app)', type: 'location' },
      ]}
      toForm={(s) => ({ name: s.name, address: s.address ?? '', phone: s.phone ?? '', lat: s.lat, lng: s.lng })}
      toBody={(v) => ({
        name: v.name, address: v.address, phone: v.phone,
        ...(v.lat != null && v.lng != null ? { lat: Number(v.lat), lng: Number(v.lng) } : {}),
      })}
      editPath={(s) => `/admin/schools/${s.id}`}
      deletePath={(s) => `/admin/schools/${s.id}`}
      deleteDetail={() => 'A school can be deleted only after its students and routes are removed.'}
      columns={[
        { label: 'School', render: (s) => <><div className="name">{s.name}</div><div className="sub2">{s.address ?? ''}</div></> },
        { label: 'Phone', render: (s) => s.phone ?? <span className="muted">—</span> },
        { label: 'On map', render: (s) => (s.lat != null ? '✓' : <span className="muted">not set</span>) },
      ]}
    />
  );
}
