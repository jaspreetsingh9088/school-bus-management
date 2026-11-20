'use client';
import { useState } from 'react';
import { CrudPage, Modal } from '@/components/Crud';
import { Shell } from '@/components/ui';
import { api, useApi } from '@/lib/api';

export default function Parents() {
  return <Shell><Body /></Shell>;
}

function Body() {
  const students = useApi('/admin/students');
  const [linking, setLinking] = useState<{ parent: any; reload: () => void } | null>(null);
  const [studentId, setStudentId] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function link() {
    if (!linking || !studentId) return;
    setError(null);
    try {
      await api(`/admin/parents/${linking.parent.parentId}/children`, { method: 'POST', body: { studentId } });
      linking.reload();
      setLinking(null);
      setStudentId('');
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      <CrudPage
        title="Parents"
        subtitle="Parents log in to the app with their mobile number. They can also sign up themselves and add a child with the student’s code."
        noun="Parent"
        listPath="/admin/parents"
        idOf={(p) => p.parentId}
        search={(p) => `${p.name} ${p.phone} ${p.children.map((c: any) => c.name).join(' ')}`}
        fields={[
          { key: 'name', label: 'Name', required: true },
          { key: 'phone', label: 'Mobile number', type: 'tel', required: true, placeholder: '98xxxxxxxx' },
          { key: 'email', label: 'Email (optional)', type: 'email' },
          { key: 'address', label: 'Home address', only: 'edit' },
        ]}
        toForm={(p) => ({ name: p.name, phone: p.phone.replace(/^\+91/, ''), email: p.email ?? '', address: p.address ?? '' })}
        editPath={(p) => `/admin/parents/${p.parentId}`}
        deletePath={(p) => `/admin/parents/${p.parentId}`}
        deleteDetail={() => 'The parent will no longer be able to log in. Their children stay in the system.'}
        columns={[
          { label: 'Parent', render: (p) => <div className="name">{p.name}</div> },
          { label: 'Mobile', render: (p) => p.phone },
          {
            label: 'Children',
            render: (p) => (
              <div className="chips">
                {p.children.length === 0 && <span className="muted">None yet</span>}
                {p.children.map((c: any) => (
                  <ChildChip key={c.studentId} parentId={p.parentId} child={c} />
                ))}
              </div>
            ),
          },
        ]}
        extraActions={(p, reload) => <button className="link" onClick={() => setLinking({ parent: p, reload })}>+ Child</button>}
      />
      {linking && (
        <Modal title={`Add a child to ${linking.parent.name}`} onClose={() => setLinking(null)}>
          <div className="stack">
            {error && <div className="alert bad">{error}</div>}
            <label className="field">
              <span className="lbl">Student</span>
              <select value={studentId} onChange={(e) => setStudentId(e.target.value)}>
                <option value="">Choose…</option>
                {(students.data ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.name}{s.className ? ` (Class ${s.className})` : ''}</option>)}
              </select>
            </label>
            <div className="row end">
              <button onClick={() => setLinking(null)}>Cancel</button>
              <button className="primary" disabled={!studentId} onClick={link}>Add child</button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

function ChildChip({ parentId, child }: { parentId: string; child: any }) {
  const [gone, setGone] = useState(false);
  if (gone) return null;
  return (
    <span className="chip">
      {child.name}
      <button
        title="Remove from this parent"
        onClick={async () => {
          await api(`/admin/parents/${parentId}/children/${child.studentId}`, { method: 'DELETE' });
          setGone(true);
        }}
      >✕</button>
    </span>
  );
}
