'use client';
import { CrudPage } from '@/components/Crud';
import { Pill, Shell } from '@/components/ui';
import { api, timeAgo } from '@/lib/api';

export default function Staff() {
  return <Shell><Body /></Shell>;
}

const ROLE: Record<string, string> = { DRIVER: 'Driver', ATTENDANT: 'Attendant', OFFICE_STAFF: 'Office staff', COMPANY_ADMIN: 'Admin' };
const office = (v: Record<string, any>) => v.role === 'OFFICE_STAFF' || v.role === 'COMPANY_ADMIN';

function Body() {
  return (
    <CrudPage
      title="Drivers & staff"
      subtitle="Drivers and attendants log in to the app with their mobile number. Office staff log in here with email and password."
      noun="Person"
      listPath="/admin/staff"
      addPath="/admin/staff"
      search={(u) => `${u.name} ${u.phone} ${ROLE[u.role]}`}
      fields={[
        { key: 'role', label: 'Job', type: 'select', required: true, only: 'add', options: Object.entries(ROLE).map(([value, label]) => ({ value, label })) },
        { key: 'name', label: 'Name', required: true },
        { key: 'phone', label: 'Mobile number', type: 'tel', required: true },
        { key: 'email', label: 'Email', type: 'email', required: true, when: office },
        { key: 'password', label: 'Password', type: 'password', required: true, when: office, hint: 'At least 8 characters. Leave empty to keep the current one.' },
        { key: 'licenseNumber', label: 'Driving licence number', when: (v) => v.role === 'DRIVER' },
        { key: 'licenseExpiry', label: 'Licence expiry', type: 'date', when: (v) => v.role === 'DRIVER' },
      ]}
      toForm={(u) => ({ role: u.role, name: u.name, phone: u.phone.replace(/^\+91/, ''), email: u.email ?? '', licenseNumber: u.licenseNumber ?? '', licenseExpiry: u.licenseExpiry ?? '' })}
      toBody={(v, isEdit) => {
        const { role, ...rest } = v;
        const body: Record<string, any> = isEdit ? rest : v;
        if (!office(v)) { delete body.email; delete body.password; }
        if (v.role !== 'DRIVER') { delete body.licenseNumber; delete body.licenseExpiry; }
        if (isEdit && !body.password) delete body.password;
        if (isEdit && body.licenseExpiry === '') delete body.licenseExpiry;
        return body;
      }}
      editPath={(u) => `/admin/staff/${u.id}`}
      deletePath={(u) => `/admin/staff/${u.id}`}
      columns={[
        { label: 'Name', render: (u) => <><div className="name">{u.name}</div><div className="sub2">{ROLE[u.role] ?? u.role}</div></> },
        { label: 'Mobile', render: (u) => u.phone },
        { label: 'Licence', render: (u) => (u.licenseNumber ? <>{u.licenseNumber}<div className="sub2">valid to {u.licenseExpiry ?? '?'}</div></> : <span className="muted">—</span>) },
        { label: 'Last login', render: (u) => <span className="muted">{u.lastLoginAt ? timeAgo(u.lastLoginAt) : 'never'}</span> },
        { label: 'Status', render: (u) => <Pill status={u.active ? 'ACTIVE' : 'INACTIVE'} /> },
      ]}
      extraActions={(u, reload) => (
        <button className="link" onClick={async () => { await api(`/admin/users/${u.id}/active/${!u.active}`, { method: 'POST' }); reload(); }}>
          {u.active ? 'Block login' : 'Allow login'}
        </button>
      )}
    />
  );
}
