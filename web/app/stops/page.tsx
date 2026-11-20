'use client';
import { CrudPage } from '@/components/Crud';
import { Map, Shell } from '@/components/ui';
import { useApi } from '@/lib/api';

export default function Stops() {
  return <Shell><Body /></Shell>;
}

function Body() {
  const stops = useApi('/admin/stops');
  return (
    <CrudPage
      title="Stops"
      subtitle="Pickup and drop-off points. Add them here, then put them on a route."
      noun="Stop"
      listPath="/admin/stops"
      wideForm
      search={(s) => `${s.name} ${s.address ?? ''}`}
      fields={[
        { key: 'name', label: 'Stop name', required: true, placeholder: 'e.g. Model Town, gate 2' },
        { key: 'address', label: 'Address or landmark (optional)' },
        { key: 'location', label: 'Location', type: 'location', required: true },
      ]}
      toForm={(s) => ({ name: s.name, address: s.address ?? '', lat: s.lat, lng: s.lng })}
      toBody={(v) => {
        if (v.lat == null || v.lng == null) throw new Error('Click on the map to set the stop’s location');
        return { name: v.name, address: v.address, lat: Number(v.lat), lng: Number(v.lng) };
      }}
      editPath={(s) => `/admin/stops/${s.id}`}
      deletePath={(s) => `/admin/stops/${s.id}`}
      columns={[
        { label: 'Stop', render: (s) => <><div className="name">{s.name}</div><div className="sub2">{s.address ?? ''}</div></> },
        { label: 'Map', render: (s) => <a href={`https://maps.google.com/?q=${s.lat},${s.lng}`} target="_blank" rel="noreferrer">View</a> },
      ]}
      top={(stops.data?.length ?? 0) > 0 && (
        <div className="panel">
          <Map points={(stops.data ?? []).map((s: any) => ({ id: s.id, lat: s.lat, lng: s.lng, kind: 'stop' as const, text: '', label: s.name }))} />
        </div>
      )}
    />
  );
}
