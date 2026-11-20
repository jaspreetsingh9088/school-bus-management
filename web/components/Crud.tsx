'use client';
import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { api, useApi } from '@/lib/api';
import { Map } from './ui';

export interface Field {
  key: string;
  label: string;
  type?: 'text' | 'tel' | 'email' | 'number' | 'date' | 'time' | 'password' | 'select' | 'checkbox' | 'location';
  options?: { value: string; label: string }[];
  required?: boolean;
  placeholder?: string;
  /** Show only when adding, or only when editing */
  only?: 'add' | 'edit';
  /** Hide unless this returns true for the current form values */
  when?: (v: Record<string, any>) => boolean;
  hint?: string;
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Confirm({ text, detail, onYes, onNo, busy, yesLabel = 'Delete' }: { text: string; detail?: string; onYes: () => void; onNo: () => void; busy?: boolean; yesLabel?: string }) {
  return (
    <Modal title={text} onClose={onNo}>
      {detail && <p className="muted">{detail}</p>}
      <div className="row end">
        <button onClick={onNo}>Cancel</button>
        <button className="danger-fill" onClick={onYes} disabled={busy}>{busy ? 'Please wait…' : yesLabel}</button>
      </div>
    </Modal>
  );
}

/** Form built from a field list. Handles add and edit. */
export function RecordForm({ fields, initial, isEdit, onSubmit, onCancel, submitLabel }: {
  fields: Field[]; initial: Record<string, any>; isEdit: boolean; submitLabel: string;
  onSubmit: (values: Record<string, any>) => Promise<void>; onCancel: () => void;
}) {
  const [v, setV] = useState<Record<string, any>>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string, val: any) => setV((old) => ({ ...old, [k]: val }));
  const visible = fields.filter((f) => (!f.only || (f.only === 'edit') === isEdit) && (!f.when || f.when(v)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit(v);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit}>
      {error && <div className="alert bad">{error}</div>}
      {visible.map((f) => {
        if (f.type === 'location') {
          const lat = v.lat === '' || v.lat == null ? null : Number(v.lat);
          const lng = v.lng === '' || v.lng == null ? null : Number(v.lng);
          return (
            <div key={f.key} className="field">
              <span className="lbl">{f.label}{f.required && ' *'}</span>
              <Map
                points={lat !== null && lng !== null ? [{ id: 'pin', lat, lng, kind: 'pin', text: '', label: 'Selected place' }] : []}
                onPick={(la, ln) => setV((old) => ({ ...old, lat: la, lng: ln }))}
                fitKey="once"
              />
              <span className="hint">{lat !== null ? `Selected: ${lat.toFixed(5)}, ${lng?.toFixed(5)}` : 'Click on the map to choose the place.'}</span>
            </div>
          );
        }
        if (f.type === 'checkbox') {
          return (
            <label key={f.key} className="check">
              <input type="checkbox" checked={!!v[f.key]} onChange={(e) => set(f.key, e.target.checked)} /> {f.label}
            </label>
          );
        }
        return (
          <label key={f.key} className="field">
            <span className="lbl">{f.label}{f.required && ' *'}</span>
            {f.type === 'select' ? (
              <select value={v[f.key] ?? ''} required={f.required} onChange={(e) => set(f.key, e.target.value)}>
                <option value="">Choose…</option>
                {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : (
              <input
                type={f.type ?? 'text'}
                value={v[f.key] ?? ''}
                required={f.required && !(f.type === 'password' && isEdit)}
                placeholder={f.placeholder}
                onChange={(e) => set(f.key, e.target.value)}
              />
            )}
            {f.hint && <span className="hint">{f.hint}</span>}
          </label>
        );
      })}
      <div className="row end">
        <button type="button" onClick={onCancel}>Cancel</button>
        <button className="primary" disabled={busy}>{busy ? 'Saving…' : submitLabel}</button>
      </div>
    </form>
  );
}

export interface Column<T> {
  label: string;
  render: (row: T) => ReactNode;
  className?: string;
}

/**
 * A list page: search, "+ Add", and Edit / Delete on every row.
 * Every admin list uses this so they all look and behave the same.
 */
export function CrudPage<T extends Record<string, any>>(props: {
  title: string;
  subtitle?: string;
  noun: string;
  listPath: string;
  rowsFrom?: (data: any) => T[];
  idOf?: (row: T) => string;
  fields: Field[];
  columns: Column<T>[];
  search: (row: T) => string;
  addPath?: string;
  editPath?: (row: T) => string;
  deletePath?: (row: T) => string;
  toBody?: (values: Record<string, any>, isEdit: boolean) => Record<string, any>;
  toForm?: (row: T) => Record<string, any>;
  deleteDetail?: (row: T) => string;
  extraActions?: (row: T, reload: () => void) => ReactNode;
  top?: ReactNode;
  wideForm?: boolean;
  canAdd?: boolean;
}) {
  const list = useApi(props.listPath);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<{ row: T | null } | null>(null);
  const [deleting, setDeleting] = useState<T | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const idOf = props.idOf ?? ((r: T) => r.id as string);
  const rows: T[] = list.data ? (props.rowsFrom ? props.rowsFrom(list.data) : list.data) : [];
  const shown = rows.filter((r) => props.search(r).toLowerCase().includes(q.trim().toLowerCase()));

  const toBody = props.toBody ?? ((v: Record<string, any>) => v);
  const clean = (o: Record<string, any>, isEdit: boolean) =>
    Object.fromEntries(Object.entries(o).filter(([, val]) => (isEdit ? val !== undefined : val !== '' && val !== undefined && val !== null)));

  async function save(values: Record<string, any>) {
    const isEdit = !!editing?.row;
    const body = clean(toBody(values, isEdit), isEdit);
    if (isEdit) await api(props.editPath!(editing!.row!), { method: 'PATCH', body });
    else await api(props.addPath ?? props.listPath, { method: 'POST', body });
    setEditing(null);
    setNote({ tone: 'good', text: isEdit ? `${props.noun} updated.` : `${props.noun} added.` });
    list.reload();
  }

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    try {
      const res = await api(props.deletePath!(deleting), { method: 'DELETE' });
      setNote({ tone: 'good', text: res?.archived ? `${props.noun} removed. Past trip records were kept.` : `${props.noun} deleted.` });
      list.reload();
    } catch (e) {
      setNote({ tone: 'bad', text: (e as Error).message });
    } finally {
      setBusy(false);
      setDeleting(null);
    }
  }

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>{props.title}</h1>
          {props.subtitle && <p className="sub">{props.subtitle}</p>}
        </div>
        {props.canAdd !== false && (
          <button className="primary" onClick={() => setEditing({ row: null })}>+ Add {props.noun.toLowerCase()}</button>
        )}
      </div>
      {note && <div className={`alert ${note.tone}`} onClick={() => setNote(null)}>{note.text}</div>}
      {list.error && <div className="alert bad">{list.error}</div>}
      {props.top}
      <div className="panel flush">
        <div className="toolbar">
          <input className="search" placeholder={`Search ${props.title.toLowerCase()}…`} value={q} onChange={(e) => setQ(e.target.value)} />
          <span className="muted small">{shown.length} of {rows.length}</span>
        </div>
        {list.loading && !list.data ? <p className="empty">Loading…</p> : shown.length === 0 ? (
          <p className="empty">{rows.length ? 'Nothing matches your search.' : `No ${props.title.toLowerCase()} yet. Click “+ Add ${props.noun.toLowerCase()}”.`}</p>
        ) : (
          <table>
            <thead><tr>{props.columns.map((c) => <th key={c.label} className={c.className}>{c.label}</th>)}<th className="actions" /></tr></thead>
            <tbody>
              {shown.map((row) => (
                <tr key={idOf(row)}>
                  {props.columns.map((c) => <td key={c.label} className={c.className}>{c.render(row)}</td>)}
                  <td className="actions">
                    {props.extraActions?.(row, list.reload)}
                    {props.editPath && <button className="link" onClick={() => setEditing({ row })}>Edit</button>}
                    {props.deletePath && <button className="link danger" onClick={() => setDeleting(row)}>Delete</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <Modal title={editing.row ? `Edit ${props.noun.toLowerCase()}` : `Add ${props.noun.toLowerCase()}`} onClose={() => setEditing(null)} wide={props.wideForm}>
          <RecordForm
            fields={props.fields}
            isEdit={!!editing.row}
            initial={editing.row ? (props.toForm ? props.toForm(editing.row) : editing.row) : {}}
            submitLabel={editing.row ? 'Save changes' : `Add ${props.noun.toLowerCase()}`}
            onSubmit={save}
            onCancel={() => setEditing(null)}
          />
        </Modal>
      )}
      {deleting && (
        <Confirm
          text={`Delete this ${props.noun.toLowerCase()}?`}
          detail={props.deleteDetail?.(deleting) ?? 'If it has past trips, those records are kept for safety, but it will be removed from all lists.'}
          onYes={remove}
          onNo={() => setDeleting(null)}
          busy={busy}
        />
      )}
    </>
  );
}
