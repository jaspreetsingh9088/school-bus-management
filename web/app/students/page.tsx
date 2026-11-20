'use client';
import { CrudPage } from '@/components/Crud';
import { Pill, Shell } from '@/components/ui';
import { api, useApi } from '@/lib/api';

export default function Students() {
  return <Shell><Body /></Shell>;
}

function Body() {
  const schools = useApi('/admin/schools');
  const approvals = useApi('/admin/approvals');
  const schoolName = (id: string) => schools.data?.find((s: any) => s.id === id)?.name ?? '';
  const adults = approvals.data?.authorizedAdults ?? [];

  return (
    <CrudPage
      title="Students"
      subtitle="Give each family the student’s 8-letter code. They type it in the app to see their child."
      noun="Student"
      listPath="/admin/students"
      search={(s) => `${s.name} ${s.className ?? ''} ${s.activationCode ?? ''}`}
      fields={[
        { key: 'name', label: 'Full name', required: true },
        { key: 'schoolId', label: 'School', type: 'select', required: true, options: (schools.data ?? []).map((s: any) => ({ value: s.id, label: s.name })) },
        { key: 'className', label: 'Class', placeholder: 'e.g. 4' },
        { key: 'section', label: 'Section', placeholder: 'e.g. B' },
        { key: 'emergencyContactPhone', label: 'Emergency phone', type: 'tel' },
        { key: 'specialInstructions', label: 'Note for the driver', placeholder: 'e.g. Needs help with the step' },
        { key: 'status', label: 'Status', type: 'select', only: 'edit', options: [{ value: 'ACTIVE', label: 'Active' }, { value: 'SUSPENDED', label: 'Paused (no bus)' }] },
      ]}
      toForm={(s) => ({ name: s.name, schoolId: s.schoolId, className: s.className ?? '', section: s.section ?? '', emergencyContactPhone: s.emergencyContactPhone ?? '', specialInstructions: s.specialInstructions ?? '', status: s.status === 'PENDING_APPROVAL' ? '' : s.status })}
      toBody={(v, isEdit) => (isEdit ? { ...v, status: v.status || undefined } : v)}
      editPath={(s) => `/admin/students/${s.id}`}
      deletePath={(s) => `/admin/students/${s.id}`}
      columns={[
        { label: 'Student', render: (s) => <><div className="name">{s.name}</div><div className="sub2">{[s.className && `Class ${s.className}`, s.section].filter(Boolean).join(' · ')}</div></> },
        { label: 'School', render: (s) => schoolName(s.schoolId) },
        { label: 'Parent code', render: (s) => <code>{s.activationCode ?? '—'}</code> },
        { label: 'Status', render: (s) => <Pill status={s.status} /> },
      ]}
      extraActions={(s, reload) => s.status === 'PENDING_APPROVAL' && (
        <button className="link" onClick={async () => { await api(`/admin/students/${s.id}/approve`, { method: 'POST' }); reload(); approvals.reload(); }}>Approve</button>
      )}
      top={adults.length > 0 && (
        <div className="panel">
          <h2>Pickup people waiting for approval</h2>
          {adults.map(({ adult, studentName }: any) => (
            <div key={adult.id} className="attention">
              <span><b>{adult.name}</b> ({adult.relation}{adult.phone ? `, ${adult.phone}` : ''}) can collect <b>{studentName}</b></span>
              <button className="primary" onClick={async () => { await api(`/admin/students/${adult.studentId}/authorized-adults/${adult.id}/approve`, { method: 'POST' }); approvals.reload(); }}>Approve</button>
            </div>
          ))}
        </div>
      )}
    />
  );
}
