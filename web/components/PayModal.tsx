'use client';
import { useState } from 'react';
import { api, inr, todayIST } from '@/lib/api';
import { Modal } from './Crud';

/** "Mark as paid" dialog: full or part amount, how it was paid, and the date. */
export function PayModal({ bill, onClose, onDone }: { bill: { invoiceId: string; name?: string; dueRupees: number; month?: string }; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState(String(bill.dueRupees));
  const [method, setMethod] = useState('CASH');
  const [reference, setReference] = useState('');
  const [paidOn, setPaidOn] = useState(todayIST());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api(`/admin/fees/${bill.invoiceId}/paid`, {
        method: 'POST',
        body: { amount: Number(amount), method, paidOn, ...(reference.trim() ? { reference: reference.trim() } : {}) },
      });
      onDone();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Record payment${bill.name ? ` — ${bill.name}` : ''}`} onClose={onClose}>
      <div className="stack">
        {error && <div className="alert bad">{error}</div>}
        <p className="muted" style={{ margin: 0 }}>Still to pay: <b>{inr(bill.dueRupees)}</b>{bill.month ? ` for ${bill.month}` : ''}</p>
        <label className="field"><span className="lbl">Amount received (₹)</span>
          <input type="number" min={1} max={bill.dueRupees} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <div className="field"><span className="lbl">Paid by</span>
          <div className="days">
            {[['CASH', 'Cash'], ['UPI', 'UPI'], ['BANK', 'Bank transfer'], ['CHEQUE', 'Cheque']].map(([v, l]) => (
              <button type="button" key={v} className={`day${method === v ? ' on' : ''}`} onClick={() => setMethod(v)}>{l}</button>
            ))}
          </div>
        </div>
        {method !== 'CASH' && (
          <label className="field"><span className="lbl">Reference (optional)</span>
            <input placeholder="UPI / cheque / transaction number" value={reference} onChange={(e) => setReference(e.target.value)} />
          </label>
        )}
        <label className="field"><span className="lbl">Date received</span>
          <input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
        </label>
        <div className="row end">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={save} disabled={busy || !Number(amount)}>{busy ? 'Saving…' : 'Mark as paid'}</button>
        </div>
      </div>
    </Modal>
  );
}
