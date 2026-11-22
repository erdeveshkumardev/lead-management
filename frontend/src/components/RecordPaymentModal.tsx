import React, { useState } from 'react';
import { Invoice, api, apiMessage, isApiError } from '../services/api';
import { CASH_LIMIT, PAYMENT_MODES, money, todayIso } from '../utils/billing';
import { AlertCircle, CreditCard, X } from 'lucide-react';

interface RecordPaymentModalProps {
  invoice: Invoice;
  onClose: () => void;
  /** Called with the updated invoice after the payment has been saved. */
  onRecorded: (updated?: Invoice) => void;
}

/** Records a receipt against a tax invoice. The server validates amount, mode, reference and the cash limit. */
export const RecordPaymentModal: React.FC<RecordPaymentModalProps> = ({ invoice, onClose, onRecorded }) => {
  const balance = Number(invoice.financials?.balance_due || 0);
  const [amount, setAmount] = useState<string>(String(balance));
  const [mode, setMode] = useState('UPI');
  const [reference, setReference] = useState('');
  const [paidOn, setPaidOn] = useState(todayIso());
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const numericAmount = Number(amount);
  const modeMeta = PAYMENT_MODES.find((m) => m.value === mode);
  const needsReference = Boolean(modeMeta?.needsReference);
  const cashTooLarge = mode === 'CASH' && numericAmount >= CASH_LIMIT;
  const valid =
    Number.isFinite(numericAmount) && numericAmount > 0 && numericAmount <= balance + 0.001 && !cashTooLarge && (!needsReference || reference.trim().length > 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    setErrorMsg('');
    const res = await api.recordPayment(invoice._id, {
      amount: numericAmount,
      payment_mode: mode,
      reference_number: reference.trim() || undefined,
      note: note.trim() || undefined,
      paid_on: paidOn || undefined,
    });
    setSaving(false);
    if (isApiError(res)) {
      setErrorMsg(apiMessage(res, 'The payment could not be recorded.'));
      return;
    }
    onRecorded(res.invoice);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-md w-full p-6 space-y-4 my-auto text-slate-900">
        <div className="flex items-center justify-between pb-3 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-emerald-600" />
            <h3 className="font-bold text-base text-slate-900">Record Payment</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="text-xs text-slate-600 space-y-1 bg-slate-50 p-3 rounded-xl border border-slate-200">
          <p>Invoice: <span className="font-bold text-slate-800">{invoice.invoice_number}</span></p>
          <p>Customer: <span className="font-semibold text-slate-800">{invoice.customer?.company_name || invoice.customer?.name}</span></p>
          <p>Balance due: <span className="font-bold text-amber-600">{money(balance)}</span></p>
        </div>

        {errorMsg && (
          <div role="alert" className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-500" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3 text-xs">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="font-semibold text-slate-700">Amount received (₹)</label>
              <button
                type="button"
                onClick={() => setAmount(String(balance))}
                className="text-[10px] text-emerald-700 font-bold hover:underline cursor-pointer bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200"
              >
                Full balance ({money(balance)})
              </button>
            </div>
            <input
              type="number"
              min="0.01"
              step="0.01"
              max={balance}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
              required
            />
            {numericAmount > balance + 0.001 && <p className="text-[10px] text-rose-600 mt-1">More than the balance due.</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="font-semibold text-slate-700 block mb-1">Payment mode</label>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs bg-white text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {PAYMENT_MODES.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="font-semibold text-slate-700 block mb-1">Received on</label>
              <input
                type="date"
                max={todayIso()}
                value={paidOn}
                onChange={(e) => setPaidOn(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>

          {cashTooLarge && (
            <p className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-2">
              Cash of ₹2,00,000 or more in one transaction is not allowed (Income-tax Act, section 269ST). Use a bank mode.
            </p>
          )}

          <div>
            <label className="font-semibold text-slate-700 block mb-1">
              Reference / UTR / cheque number {needsReference && <span className="text-rose-500">*</span>}
            </label>
            <input
              type="text"
              maxLength={60}
              required={needsReference}
              placeholder="e.g. UTR12938471203"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="font-semibold text-slate-700 block mb-1">Note (optional)</label>
            <input
              type="text"
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="pt-2 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !valid}
              className="px-5 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Record payment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
