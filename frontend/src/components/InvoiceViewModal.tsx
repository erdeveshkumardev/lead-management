import React, { useEffect, useState } from 'react';
import { Invoice, CurrentUser, api, apiMessage, can, isApiError } from '../services/api';
import { PdfDownloadButton } from './PdfDownloadButton';
import { canTakePayment, documentLabel, money, paymentStatusMeta } from '../utils/billing';
import { formatIndianDate } from '../utils/dateUtils';
import { 
  X, 
  Download, 
  Printer, 
  CreditCard, 
  CheckCircle2, 
  Clock, 
  AlertCircle, 
  Building2, 
  User, 
  Phone, 
  Mail, 
  Receipt,
  FileText,
  Ban,
  Undo2,
  FileCheck2
} from 'lucide-react';

interface InvoiceViewModalProps {
  invoice: Invoice;
  tenantId?: string;
  currentUser?: CurrentUser | null;
  onClose: () => void;
  onRecordPayment?: (invoice: Invoice) => void;
  /** Called after the document changed on the server (cancelled, payment reversed, converted). */
  onChanged?: () => void;
}

type PendingAction = { kind: 'cancel' } | { kind: 'reverse'; paymentId: string; amount: number } | { kind: 'convert' } | null;

export const InvoiceViewModal: React.FC<InvoiceViewModalProps> = ({
  invoice: initialInvoice,
  currentUser,
  onClose,
  onRecordPayment,
  onChanged,
}) => {
  // issued documents are never edited: they are cancelled, or payments are reversed, with a reason on record
  const [invoice, setInvoice] = useState<Invoice>(initialInvoice);
  const [pending, setPending] = useState<PendingAction>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [infoMsg, setInfoMsg] = useState('');
  // set after the server reports that the lead already has a live tax invoice
  const [allowAdditional, setAllowAdditional] = useState(false);

  useEffect(() => {
    setInvoice(initialInvoice);
  }, [initialInvoice]);

  const isInvoice = invoice.document_type === 'TAX_INVOICE';
  const isCancelled = invoice.payment_status === 'CANCELLED';
  const status = paymentStatusMeta(invoice.payment_status);
  const livePayments = (invoice.payments || []).filter((p) => !p.is_reversed);
  const mayCancel = can(currentUser, 'billing_cancel') && !isCancelled;
  const mayReverse = can(currentUser, 'billing_payments') && isInvoice && !isCancelled;
  const mayConvert = can(currentUser, 'billing_convert') && !isInvoice && !isCancelled && !invoice.converted_invoice_id;
  const mayRecordPayment = can(currentUser, 'billing_payments') && canTakePayment(invoice) && Boolean(onRecordPayment);

  const statusBadge = () => (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black border ${status.className}`}>
      {invoice.payment_status === 'PAID' ? (
        <CheckCircle2 className="h-3.5 w-3.5" />
      ) : invoice.payment_status === 'PARTIALLY_PAID' ? (
        <Clock className="h-3.5 w-3.5" />
      ) : isCancelled ? (
        <Ban className="h-3.5 w-3.5" />
      ) : (
        <AlertCircle className="h-3.5 w-3.5" />
      )}
      <span>{status.label.toUpperCase()}</span>
    </span>
  );

  const openAction = (action: PendingAction) => {
    if (busy) return; // a change is being saved: its result would close a form opened now
    setPending(action);
    setReason('');
    setErrorMsg('');
    setInfoMsg('');
    setAllowAdditional(false);
  };

  const runAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pending) return;
    setBusy(true);
    setErrorMsg('');
    let res: any;
    if (pending.kind === 'cancel') res = await api.cancelInvoice(invoice._id, reason.trim());
    else if (pending.kind === 'reverse') res = await api.reversePayment(invoice._id, pending.paymentId, reason.trim());
    else res = await api.convertQuotationToInvoice(invoice._id, { allow_additional_invoice: allowAdditional });
    setBusy(false);

    if (isApiError(res)) {
      if (pending.kind === 'convert' && res.code === 'INVOICE_EXISTS' && !allowAdditional) {
        // never raise a second bill for the same deal by accident
        setAllowAdditional(true);
        setErrorMsg(`${res.detail} Continue only if a second tax invoice is really intended.`);
      } else {
        setErrorMsg(apiMessage(res, 'The change could not be saved.'));
      }
      return;
    }
    if (pending.kind === 'convert') {
      // the quotation stays on record; the new tax invoice is a separate, numbered document
      setInfoMsg(res.message || 'Tax invoice created from this document.');
      if (res.quotation) setInvoice(res.quotation);
      else setInvoice({ ...invoice, converted_invoice_id: res.invoice_id || res.invoice?._id || 'converted' });
    } else {
      if (res.invoice) setInvoice(res.invoice);
      setInfoMsg(res.message || 'Saved.');
    }
    setPending(null);
    setReason('');
    onChanged?.();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-2 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl sm:rounded-3xl shadow-2xl border border-slate-200 max-w-4xl w-full max-h-[96vh] sm:max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Top Action Header */}
        <div className="px-4 sm:px-6 py-3 sm:py-4 bg-slate-900 text-white flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-10 w-10 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-md shrink-0">
              <Receipt className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <h3 className="text-base font-bold text-white tracking-tight">
                  {documentLabel(invoice.document_type)}
                </h3>
                {statusBadge()}
              </div>
              <p className="text-xs text-slate-400 font-mono truncate">
                <span className="hidden sm:inline">Doc Number: </span><span className="text-indigo-300 font-bold">{invoice.invoice_number}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* phones: the same button is in the footer, where there is room for it */}
            <PdfDownloadButton
              invoiceId={invoice._id}
              invoiceNumber={invoice.invoice_number}
              label="Download PDF"
              iconClassName="h-3.5 w-3.5"
              className="hidden sm:inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-md transition-all cursor-pointer"
            />

            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Modal Scrollable Body (Clean Invoice Preview) */}
        <div className="p-6 md:p-8 overflow-y-auto flex-1 space-y-6 text-slate-900 bg-slate-50/50">
          {errorMsg && (
            <div role="alert" className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-500" />
              <span>{errorMsg}</span>
            </div>
          )}
          {infoMsg && (
            <div role="status" className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs flex items-center gap-2 font-bold">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
              <span>{infoMsg}</span>
            </div>
          )}
          {isCancelled && (
            <div className="p-3 bg-slate-100 border border-slate-300 rounded-xl text-slate-700 text-xs flex items-start gap-2">
              <Ban className="h-4 w-4 shrink-0 text-slate-500 mt-0.5" />
              <span>
                <strong>This document is cancelled</strong> and stays on record for audit.
                {invoice.cancellation_reason ? ` Reason: ${invoice.cancellation_reason}` : ''}
              </span>
            </div>
          )}
          {invoice.converted_invoice_id && !isInvoice && (
            <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-xl text-indigo-800 text-xs flex items-center gap-2">
              <FileCheck2 className="h-4 w-4 shrink-0 text-indigo-600" />
              <span>A tax invoice has already been raised from this document.</span>
            </div>
          )}

          {/* Reason prompt for cancel / reverse / convert */}
          {pending && (
            <form onSubmit={runAction} className="p-4 bg-amber-50 border border-amber-200 rounded-2xl space-y-3 text-xs">
              <p className="font-bold text-amber-900">
                {pending.kind === 'cancel' && `Cancel ${invoice.invoice_number}? The number is kept and the document is marked cancelled.`}
                {pending.kind === 'reverse' && `Reverse the payment of ${money(pending.amount)}? The entry stays in the ledger, marked reversed.`}
                {pending.kind === 'convert' && `Raise a GST tax invoice from ${invoice.invoice_number}? It gets the next invoice number.`}
              </p>
              {pending.kind !== 'convert' && (
                <textarea
                  required
                  minLength={3}
                  maxLength={500}
                  rows={2}
                  autoFocus
                  placeholder="Reason (kept in the audit trail)"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-amber-300 bg-white text-slate-900 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              )}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setPending(null)} className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 font-bold">
                  Keep as is
                </button>
                <button
                  type="submit"
                  disabled={busy || (pending.kind !== 'convert' && reason.trim().length < 3)}
                  className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-black disabled:opacity-50"
                >
                  {busy ? 'Saving…' : pending.kind === 'cancel' ? 'Cancel document' : pending.kind === 'reverse' ? 'Reverse payment' : allowAdditional ? 'Create another tax invoice' : 'Create tax invoice'}
                </button>
              </div>
            </form>
          )}
          {/* Symmetrical Dual Party Info */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Supplier / Seller */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-2">
              <span className="text-[10px] uppercase tracking-wider font-extrabold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-100">
                Issued By (Supplier)
              </span>
              <h4 className="font-bold text-sm text-slate-900">{invoice.seller?.company_name || invoice.seller?.name}</h4>
              <p className="text-xs text-slate-500">{invoice.seller?.name}</p>
              <div className="text-xs text-slate-600 space-y-1 pt-1 border-t border-slate-100">
                <p><b>GSTIN:</b> {invoice.seller?.gstin || 'N/A'}</p>
                <p><b>Phone:</b> {invoice.seller?.phone || 'N/A'}</p>
                <p><b>State:</b> {invoice.seller?.state || 'N/A'}{invoice.seller?.state_code ? ` (${invoice.seller.state_code})` : ''}</p>
              </div>
            </div>

            {/* Customer / Billed To */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[10px] uppercase tracking-wider font-extrabold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100 whitespace-nowrap">
                  Billed To (Customer)
                </span>
                <span className="text-xs text-slate-500 font-medium">
                  Date: <b>{formatIndianDate(invoice.invoice_date)}</b>
                  {invoice.due_date ? <> · Due: <b>{formatIndianDate(invoice.due_date)}</b></> : null}
                </span>
              </div>
              <h4 className="font-bold text-sm text-slate-900">{invoice.customer?.company_name || invoice.customer?.name}</h4>
              <p className="text-xs text-slate-500">Contact: {invoice.customer?.name}</p>
              <div className="text-xs text-slate-600 space-y-1 pt-1 border-t border-slate-100">
                <p><b>GSTIN:</b> {invoice.customer?.gstin || 'Unregistered Buyer'}</p>
                <p><b>Phone:</b> {invoice.customer?.phone || 'N/A'}</p>
                <p><b>State:</b> {invoice.customer?.state || 'N/A'}</p>
                {invoice.place_of_supply_name && (
                  <p>
                    <b>Place of supply:</b> {invoice.place_of_supply_name}
                    {invoice.place_of_supply_code ? ` (${invoice.place_of_supply_code})` : ''} ·{' '}
                    {invoice.is_interstate ? 'Inter-state (IGST)' : 'Within state (CGST + SGST)'}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Line Items Table */}
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
            <div className="px-5 py-3.5 bg-slate-900 text-white font-bold text-xs flex items-center justify-between">
              <span>Itemized Commercial Particulars</span>
              <span className="text-slate-400 font-normal text-[11px]">{invoice.items?.length || 0} line items</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider text-[10px] border-b border-slate-200">
                  <tr>
                    <th className="py-2.5 px-4 font-bold">#</th>
                    <th className="py-2.5 px-4 font-bold">Item Description</th>
                    <th className="py-2.5 px-4 font-bold">HSN/SAC</th>
                    <th className="py-2.5 px-4 font-bold text-right">Qty</th>
                    <th className="py-2.5 px-4 font-bold text-right">Unit Rate</th>
                    <th className="py-2.5 px-4 font-bold text-right">Taxable</th>
                    <th className="py-2.5 px-4 font-bold text-center">GST %</th>
                    <th className="py-2.5 px-4 font-bold text-right">Total (₹)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {invoice.items?.map((item, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-4 font-mono text-slate-400 text-[11px]">{idx + 1}</td>
                      <td className="py-3 px-4 font-bold text-slate-900">{item.name}</td>
                      <td className="py-3 px-4 font-mono text-slate-500 text-[11px]">{item.hsn_sac_code || '-'}</td>
                      <td className="py-3 px-4 text-right font-medium text-slate-700">{item.quantity} {item.unit}</td>
                      <td className="py-3 px-4 text-right font-mono text-slate-700">{money(item.unit_price)}</td>
                      <td className="py-3 px-4 text-right font-mono font-medium text-slate-900">{money(item.taxable_amount)}</td>
                      <td className="py-3 px-4 text-center">
                        <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 font-bold text-[10px]">
                          {item.gst_rate}%
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-indigo-950">{money(item.total_amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Bottom Split: Terms & Payment Ledger on Left, Financials Summary on Right */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
            {/* Left: Terms & Payment Records */}
            <div className="space-y-4">
              {/* Payment History Card */}
              <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-xs text-slate-900 flex items-center gap-1.5">
                    <CreditCard className="h-4 w-4 text-emerald-600" />
                    <span>Payment Records & Receipts</span>
                  </h4>
                  <span className="text-[10px] font-bold text-slate-500">
                    {livePayments.length} received
                  </span>
                </div>

                {(!invoice.payments || invoice.payments.length === 0) ? (
                  <p className="text-xs text-slate-400 italic py-2">
                    {isInvoice ? 'No payment transactions recorded yet.' : 'Payments are recorded against tax invoices only.'}
                  </p>
                ) : (
                  <div className="space-y-2 pt-1">
                    {invoice.payments.map((p) => (
                      <div
                        key={p.payment_id}
                        className={`p-2.5 rounded-xl border flex items-center justify-between gap-2 text-xs ${
                          p.is_reversed ? 'bg-slate-100 border-slate-200 opacity-70' : 'bg-slate-50 border-slate-100'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`font-bold text-slate-900 ${p.is_reversed ? 'line-through' : ''}`}>{money(p.amount)}</span>
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                              {p.payment_mode || 'Payment'}
                            </span>
                            {p.is_reversed && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200">REVERSED</span>
                            )}
                          </div>
                          {p.reference_number && <span className="text-[10px] font-mono text-slate-400 block truncate">Ref: {p.reference_number}</span>}
                          {p.is_reversed && p.reversal_reason && (
                            <span className="text-[10px] text-rose-600 block truncate">Reason: {p.reversal_reason}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[10px] text-slate-400 font-medium">{p.paid_at ? formatIndianDate(p.paid_at) : ''}</span>
                          {mayReverse && !p.is_reversed && (
                            <button
                              type="button"
                              onClick={() => openAction({ kind: 'reverse', paymentId: p.payment_id, amount: p.amount })}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-rose-200 text-rose-700 hover:bg-rose-50 text-[10px] font-bold"
                              title="Reverse this payment (wrong entry, bounced cheque...)"
                            >
                              <Undo2 className="h-3 w-3" />
                              <span>Reverse</span>
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Terms and conditions */}
              {invoice.terms_and_conditions && (
                <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs text-xs space-y-1">
                  <h5 className="font-bold text-slate-700 text-[11px]">Terms & Conditions:</h5>
                  <p className="text-slate-500 whitespace-pre-line text-[11px] leading-relaxed">
                    {invoice.terms_and_conditions}
                  </p>
                </div>
              )}
            </div>

            {/* Right: Totals Card */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm space-y-3">
              <h4 className="font-bold text-xs text-slate-900 border-b border-slate-100 pb-2">
                Financial Summary & Tax Ledger
              </h4>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between text-slate-600">
                  <span>Taxable Subtotal:</span>
                  <span className="font-mono font-bold text-slate-800">{money(invoice.financials?.taxable_subtotal)}</span>
                </div>

                {Number(invoice.financials?.total_discount || 0) > 0 && (
                  <div className="flex justify-between text-slate-500">
                    <span>Discount given (already deducted):</span>
                    <span className="font-mono">{money(invoice.financials.total_discount)}</span>
                  </div>
                )}

                {Number(invoice.financials?.total_cgst || 0) > 0 && (
                  <div className="flex justify-between text-slate-600">
                    <span>Central GST (CGST):</span>
                    <span className="font-mono text-slate-800">{money(invoice.financials.total_cgst)}</span>
                  </div>
                )}

                {Number(invoice.financials?.total_sgst || 0) > 0 && (
                  <div className="flex justify-between text-slate-600">
                    <span>State GST (SGST):</span>
                    <span className="font-mono text-slate-800">{money(invoice.financials.total_sgst)}</span>
                  </div>
                )}

                {Number(invoice.financials?.total_igst || 0) > 0 && (
                  <div className="flex justify-between text-slate-600">
                    <span>Integrated GST (IGST):</span>
                    <span className="font-mono text-slate-800">{money(invoice.financials.total_igst)}</span>
                  </div>
                )}

                {Number(invoice.financials?.round_off || 0) !== 0 && (
                  <div className="flex justify-between text-slate-500">
                    <span>Round off:</span>
                    <span className="font-mono">{money(invoice.financials.round_off)}</span>
                  </div>
                )}

                <div className="flex justify-between text-sm font-black text-indigo-950 pt-2 border-t-2 border-slate-900">
                  <span>Grand Total (INR):</span>
                  <span className="font-mono text-base text-indigo-700">{money(invoice.financials?.grand_total)}</span>
                </div>

                {invoice.amount_in_words && <p className="text-[11px] text-slate-500 italic">{invoice.amount_in_words}</p>}

                {isInvoice && (
                  <>
                    <div className="flex justify-between text-xs text-slate-600 pt-1">
                      <span>Total Paid:</span>
                      <span className="font-mono font-bold text-emerald-700">{money(invoice.financials?.paid_amount)}</span>
                    </div>

                    <div className="flex justify-between text-xs font-bold pt-1 border-t border-slate-100">
                      <span className={invoice.financials?.balance_due > 0 ? 'text-rose-700' : 'text-emerald-700'}>Balance Due:</span>
                      <span className={`font-mono text-sm ${invoice.financials?.balance_due > 0 ? 'text-rose-700 font-black' : 'text-emerald-700'}`}>
                        {money(invoice.financials?.balance_due)}
                      </span>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer with Actions */}
        <div className="px-6 py-4 bg-white border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            Close
          </button>

          <div className="flex items-center gap-2">
            {mayCancel && (
              <button
                type="button"
                onClick={() => openAction({ kind: 'cancel' })}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-rose-200 text-rose-700 hover:bg-rose-50 font-bold text-xs cursor-pointer"
              >
                <Ban className="h-4 w-4" />
                <span>Cancel document</span>
              </button>
            )}

            {mayConvert && (
              <button
                type="button"
                onClick={() => openAction({ kind: 'convert' })}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-indigo-200 text-indigo-700 hover:bg-indigo-50 font-bold text-xs cursor-pointer"
              >
                <FileCheck2 className="h-4 w-4" />
                <span>Convert to tax invoice</span>
              </button>
            )}

            {/* Record Payment Button */}
            {mayRecordPayment && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onRecordPayment?.(invoice);
                }}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md shadow-emerald-600/20 transition-all cursor-pointer"
              >
                <CreditCard className="h-4 w-4" />
                <span>Record Payment / Mark as Paid</span>
              </button>
            )}

            <PdfDownloadButton
              invoiceId={invoice._id}
              invoiceNumber={invoice.invoice_number}
              label="Download PDF"
              iconClassName="h-4 w-4"
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-md shadow-blue-600/20 transition-all cursor-pointer"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
