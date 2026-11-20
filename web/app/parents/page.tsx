'use client';
import { FormEvent, useState } from 'react';
import { clean, ErrorNote, Shell, useForm } from '@/components/ui';
import { api, useApi } from '@/lib/api';

export default function Parents() {
  return <Shell><Body /></Shell>;
}

function Body() {
  const parents = useApi('/admin/parents');
  const students = useApi('/admin/students');
  const f = useForm({ name: '', phone: '', email: '' });
  const [link, setLink] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api('/admin/parents', { method: 'POST', body: clean(f.values) });
      f.reset();
      parents.reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function linkChild(parentId: string) {
    if (!link[parentId]) return;
    setError(null);
    try {
      await api(`/admin/parents/${parentId}/children`, { method: 'POST', body: { studentId: link[parentId] } });
      parents.reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <>
      <h1>Parents</h1>
      <p className="sub">Parents log in to the app with their mobile number. They can also sign up themselves and link a child with the student’s code.</p>
      <ErrorNote error={error ?? parents.error} />
      <div className="panel">
        <h2>Add a parent</h2>
        <form className="inline" onSubmit={add}>
          <label>Name<input required {...f.bind('name')} /></label>
          <label>Mobile number<input required placeholder="98xxxxxxxx" {...f.bind('phone')} /></label>
          <label>Email (optional)<input type="email" {...f.bind('email')} /></label>
          <button className="primary">Add parent</button>
        </form>
      </div>
      <div className="panel">
        <table>
          <thead><tr><th>Name</th><th>Mobile</th><th>Children</th><th>Link a child</th></tr></thead>
          <tbody>
            {(parents.data ?? []).map((p: any) => (
              <tr key={p.parentId}>
                <td>{p.name}</td>
                <td>{p.phone}</td>
                <td>{p.children.map((c: any) => c.name).join(', ') || <span className="muted">—</span>}</td>
                <td>
                  <div className="row">
                    <select value={link[p.parentId] ?? ''} onChange={(e) => setLink({ ...link, [p.parentId]: e.target.value })} style={{ width: 180 }}>
                      <option value="">Choose student…</option>
                      {(students.data ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                    <button onClick={() => linkChild(p.parentId)}>Link</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!parents.data?.length && <p className="empty">No parents yet.</p>}
      </div>
    </>
  );
}
