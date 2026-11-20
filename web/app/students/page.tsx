'use client';
import { FormEvent, useState } from 'react';
import { clean, ErrorNote, Pill, Shell, useForm } from '@/components/ui';
import { api, useApi } from '@/lib/api';

export default function Students() {
  return <Shell><Body /></Shell>;
}

function Body() {
  const students = useApi('/admin/students');
  const schools = useApi('/admin/schools');
  const approvals = useApi('/admin/approvals');
  const f = useForm({ name: '', schoolId: '', className: '', section: '', registrationNumber: '', emergencyContactPhone: '' });
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const schoolName = (id: string) => schools.data?.find((s: any) => s.id === id)?.name ?? '';

  async function add(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api('/admin/students', { method: 'POST', body: clean(f.values) });
      f.reset();
      students.reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function act(path: string) {
    setError(null);
    try {
      await api(path, { method: 'POST' });
      students.reload();
      approvals.reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const list = (students.data ?? []).filter((s: any) => s.name.toLowerCase().includes(q.toLowerCase()));
  const pendingAdults = approvals.data?.authorizedAdults ?? [];

  return (
    <>
      <h1>Students</h1>
      <p className="sub">Give each family the 8-letter code: they enter it in the app to link their child.</p>
      <ErrorNote error={error ?? students.error} />

      {pendingAdults.length > 0 && (
        <div className="panel">
          <h2>Pickup people waiting for approval</h2>
          <table>
            <tbody>
              {pendingAdults.map(({ adult, studentName }: any) => (
                <tr key={adult.id}>
                  <td><b>{adult.name}</b> ({adult.relation}) {adult.phone}</td>
                  <td>for {studentName}</td>
                  <td><button className="primary" onClick={() => act(`/admin/students/${adult.studentId}/authorized-adults/${adult.id}/approve`)}>Approve</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="panel">
        <h2>Add a student</h2>
        <form className="inline" onSubmit={add}>
          <label>Name<input required {...f.bind('name')} /></label>
          <label>School
            <select required {...f.bind('schoolId')}>
              <option value="">Choose…</option>
              {(schools.data ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label>Class<input {...f.bind('className')} /></label>
          <label>Section<input {...f.bind('section')} /></label>
          <label>Student ID<input {...f.bind('registrationNumber')} /></label>
          <label>Emergency phone<input {...f.bind('emergencyContactPhone')} /></label>
          <button className="primary">Add student</button>
        </form>
      </div>

      <div className="panel">
        <div className="row between" style={{ marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>All students ({list.length})</h2>
          <input placeholder="Search by name" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 220 }} />
        </div>
        <table>
          <thead><tr><th>Name</th><th>School</th><th>Class</th><th>Status</th><th>Parent code</th><th /></tr></thead>
          <tbody>
            {list.map((s: any) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td>{schoolName(s.schoolId)}</td>
                <td>{[s.className, s.section].filter(Boolean).join(' ')}</td>
                <td><Pill status={s.status} /></td>
                <td><code>{s.activationCode ?? '—'}</code></td>
                <td>{s.status === 'PENDING_APPROVAL' && <button className="primary" onClick={() => act(`/admin/students/${s.id}/approve`)}>Approve</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!list.length && <p className="empty">No students yet.</p>}
      </div>
    </>
  );
}
