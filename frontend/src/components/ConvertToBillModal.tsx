import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CurrentUser, Invoice, Lead, Product, api, apiMessage, isApiError, newIdempotencyKey } from '../services/api';
import { X, Plus, Trash2, Receipt, FileText, CheckCircle2, AlertCircle, Eye, MapPin } from 'lucide-react';
import { InvoiceViewModal } from './InvoiceViewModal';
import { PdfDownloadButton } from './PdfDownloadButton';
import { documentLabel, money, todayIso } from '../utils/billing';
import { GST_RATES, gstinProblem, normalizeGstin, stateCodeFromGstin } from '../utils/gst';

interface ConvertToBillModalProps {
  lead: Lead;
  currentUser?: CurrentUser | null;
  onClose: () => void;
  onSuccess: () => void;
}

interface ItemRow {
  product_id?: string;
  name: string;
  hsn_sac_code: string;
  quantity: number;
  unit: string;
  unit_price: number;
  discount_percentage: number;
  gst_rate: number;
}

type DocType = 'TAX_INVOICE' | 'QUOTATION' | 'PROFORMA';

const HSN_RE = /^[0-9]{4,8}$/;
const inputClass =
  'w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500';

export const ConvertToBillModal: React.FC<ConvertToBillModalProps> = ({ lead, currentUser, onClose, onSuccess }) => {
  const [docType, setDocType] = useState<DocType>('TAX_INVOICE');
  const [productsList, setProductsList] = useState<Product[]>([]);
  const [states, setStates] = useState<Array<{ code: string; name: string }>>([]);
  const [sellerStateCode, setSellerStateCode] = useState('');
  const [sellerHasGstin, setSellerHasGstin] = useState(true);
  const [dueDate, setDueDate] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [items, setItems] = useState<ItemRow[]>([
    {
      name: lead.product_inquired || '',
      hsn_sac_code: '',
      quantity: 1,
      unit: 'Nos',
      unit_price: lead.deal_value > 0 ? Number(lead.deal_value) : 0,
      discount_percentage: 0,
      gst_rate: 18,
    },
  ]);

  // Billing details of the customer (saved back to the lead by the server)
  const [companyName, setCompanyName] = useState(lead.company_name || '');
  const [gstin, setGstin] = useState(lead.gstin || '');
  const [address, setAddress] = useState(lead.address || '');
  const [city, setCity] = useState(lead.city || '');
  const [pincode, setPincode] = useState(lead.pincode || '');
  const [stateCode, setStateCode] = useState(lead.state_code || '');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createdInvoice, setCreatedInvoice] = useState<Invoice | null>(null);
  const [createdMessage, setCreatedMessage] = useState('');
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  // set when the server says this lead already has a live tax invoice
  const [duplicateWarning, setDuplicateWarning] = useState('');

  // One key for this dialog: a double click or a retried request can never create two documents.
  const idempotencyKey = useRef(newIdempotencyKey());

  useEffect(() => {
    let alive = true;
    api.getProducts().then((res) => alive && setProductsList(Array.isArray(res) ? res : []));
    api.getGstStates().then((res) => {
      if (!alive) return;
      setStates(res);
      // a state typed as free text on the lead (e.g. "Gujarat") is matched to its GST code
      if (!lead.state_code && lead.state) {
        const match = res.find((s) => s.name.toLowerCase() === String(lead.state).trim().toLowerCase());
        if (match) setStateCode((current) => current || match.code);
      }
    });
    api.getTenant().then((tenant) => {
      if (!alive || !tenant || isApiError(tenant)) return;
      setSellerStateCode(tenant.state_code || stateCodeFromGstin(tenant.gstin) || '');
      setSellerHasGstin(Boolean(tenant.gstin));
      setNotes((current) => current || '');
    });
    return () => {
      alive = false;
    };
  }, [lead.state, lead.state_code]);

  const gstinState = stateCodeFromGstin(gstin);
  const gstinError = gstinProblem(gstin);
  // The state inside a valid GSTIN wins over the state picked by hand (same rule as the server)
  const placeOfSupply = !gstinError && gstinState ? gstinState : stateCode;
  const placeOfSupplyName = states.find((s) => s.code === placeOfSupply)?.name || '';
  const interstate = Boolean(sellerStateCode && placeOfSupply && sellerStateCode !== placeOfSupply);
  const taxSplitKnown = Boolean(sellerStateCode && placeOfSupply);
  const isBill = docType === 'TAX_INVOICE';

  const handleAddItem = () => {
    setItems([...items, { name: '', hsn_sac_code: '', quantity: 1, unit: 'Nos', unit_price: 0, discount_percentage: 0, gst_rate: 18 }]);
  };

  const handleRemoveItem = (index: number) => {
    if (items.length > 1) setItems(items.filter((_, i) => i !== index));
  };

  const handleItemChange = (index: number, field: keyof ItemRow, value: any) => {
    const updated = [...items];
    updated[index] = { ...updated[index], [field]: value };
    setItems(updated);
  };

  const handleSelectCatalogProduct = (index: number, productId: string) => {
    const prod = productsList.find((p) => p._id === productId);
    if (!prod) return;
    const updated = [...items];
    updated[index] = {
      ...updated[index],
      product_id: prod._id,
      name: prod.name,
      hsn_sac_code: prod.hsn_sac_code || '',
      unit: prod.unit || 'Nos',
      unit_price: Number(prod.unit_price),
      gst_rate: Number(prod.gst_rate ?? 18),
    };
    setItems(updated);
  };

  // Live preview. The server recalculates everything with exact decimal arithmetic and rounding.
  const totals = useMemo(() => {
    let taxable = 0;
    let tax = 0;
    let discount = 0;
    items.forEach((item) => {
      const base = Number(item.quantity || 0) * Number(item.unit_price || 0);
      const disc = (base * Number(item.discount_percentage || 0)) / 100;
      const net = base - disc;
      discount += disc;
      taxable += net;
      tax += (net * Number(item.gst_rate || 0)) / 100;
    });
    const exact = taxable + tax;
    const grand = Math.round(exact);
    return { taxable, tax, discount, grand, roundOff: grand - exact };
  }, [items]);

  const problems: string[] = [];
  items.forEach((item, idx) => {
    const label = item.name?.trim() || `Item ${idx + 1}`;
    if (!item.name?.trim()) problems.push(`Item ${idx + 1}: enter a name.`);
    if (!(Number(item.quantity) > 0)) problems.push(`${label}: quantity must be more than zero.`);
    if (Number(item.unit_price) < 0) problems.push(`${label}: rate cannot be negative.`);
    if (Number(item.discount_percentage) < 0 || Number(item.discount_percentage) > 100) problems.push(`${label}: discount must be 0-100%.`);
    if (isBill && !HSN_RE.test((item.hsn_sac_code || '').trim())) problems.push(`${label}: HSN/SAC code (4-8 digits) is required on a tax invoice.`);
    if (!isBill && item.hsn_sac_code && !HSN_RE.test(item.hsn_sac_code.trim())) problems.push(`${label}: HSN/SAC code must be 4-8 digits.`);
  });
  if (gstinError) problems.push(`Customer ${gstinError}`);
  if (pincode && !/^[1-9][0-9]{5}$/.test(pincode.trim())) problems.push('PIN code must be 6 digits.');
  if (isBill && !placeOfSupply) problems.push("Select the customer's state (place of supply) or enter their GSTIN.");
  if (isBill && !sellerHasGstin) problems.push('Your company GSTIN is missing. Add it in Company & API Settings before issuing tax invoices.');
  if (dueDate && dueDate < todayIso()) problems.push('Due date cannot be in the past.');
  if (isBill && totals.grand <= 0) problems.push('The invoice total must be more than zero.');

  const submit = async (allowAdditional: boolean) => {
    if (isSubmitting || problems.length > 0) return;
    setIsSubmitting(true);
    setErrorMessage('');

    const payload = {
      document_type: docType,
      due_date: dueDate || undefined,
      notes: notes.trim() || undefined,
      place_of_supply_code: placeOfSupply || undefined,
      allow_additional_invoice: allowAdditional,
      customer: {
        company_name: companyName.trim() || undefined,
        gstin: normalizeGstin(gstin) || undefined,
        address: address.trim() || undefined,
        city: city.trim() || undefined,
        pincode: pincode.trim() || undefined,
        state_code: placeOfSupply || undefined,
      },
      items: items.map((itm) => ({
        product_id: itm.product_id,
        name: itm.name.trim(),
        hsn_sac_code: (itm.hsn_sac_code || '').trim() || undefined,
        quantity: Number(itm.quantity),
        unit: itm.unit || 'Nos',
        unit_price: Number(itm.unit_price),
        discount_percentage: Number(itm.discount_percentage || 0),
        gst_rate: Number(itm.gst_rate),
      })),
    };

    const res = await api.convertLeadToBill(lead._id, payload, undefined, idempotencyKey.current);
    setIsSubmitting(false);

    if (isApiError(res)) {
      if (res.code === 'INVOICE_EXISTS' && !allowAdditional) {
        setDuplicateWarning(res.detail);
      } else {
        setDuplicateWarning('');
        setErrorMessage(apiMessage(res, 'The document could not be created.'));
      }
      return;
    }
    setDuplicateWarning('');
    setCreatedInvoice(res.invoice);
    setCreatedMessage(res.message || 'Document created.');
    onSuccess();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-5xl w-full max-h-[94vh] flex flex-col overflow-hidden text-slate-900">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center space-x-3">
            <div className="h-10 w-10 rounded-xl bg-blue-600 flex items-center justify-center text-white">
              <Receipt className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Convert Lead to {documentLabel(docType)}</h3>
              <p className="text-xs text-slate-500">
                Customer: <span className="font-semibold text-slate-700">{lead.full_name}</span> ({lead.company_name || 'Individual'})
              </p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {createdInvoice ? (
            <div className="text-center py-8 space-y-4">
              <div className="h-16 w-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle2 className="h-10 w-10" />
              </div>
              <h4 className="text-xl font-bold text-slate-900">{documentLabel(createdInvoice.document_type)} created</h4>
              <p className="text-sm text-slate-600">
                Number: <span className="font-bold text-blue-700">{createdInvoice.invoice_number}</span> · Total{' '}
                <span className="font-bold">{money(createdInvoice.financials?.grand_total)}</span>
              </p>
              <p className="text-xs text-slate-500">{createdMessage}</p>
              <div className="pt-4 flex flex-wrap justify-center gap-3">
                <button
                  type="button"
                  onClick={() => setShowPreviewModal(true)}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 text-white font-semibold text-sm hover:bg-indigo-700 shadow-md transition-colors cursor-pointer"
                >
                  <Eye className="h-4 w-4" />
                  <span>View Details & Items</span>
                </button>
                <PdfDownloadButton
                  invoiceId={createdInvoice._id}
                  invoiceNumber={createdInvoice.invoice_number}
                  label="Download PDF"
                  iconClassName="h-4 w-4"
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 text-white font-semibold text-sm hover:bg-blue-700 shadow-md transition-colors"
                />
                <button onClick={onClose} className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-semibold text-sm hover:bg-slate-200 transition-colors">
                  Close
                </button>
              </div>

              {showPreviewModal && (
                <InvoiceViewModal invoice={createdInvoice} currentUser={currentUser} onClose={() => setShowPreviewModal(false)} onChanged={onSuccess} />
              )}
            </div>
          ) : (
            <>
              {errorMessage && (
                <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 flex-shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}

              {duplicateWarning && (
                <div role="alert" className="p-4 bg-amber-50 border border-amber-300 rounded-xl text-amber-900 text-xs space-y-3">
                  <p className="font-bold flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" />
                    <span>{duplicateWarning}</span>
                  </p>
                  <p>Raising a second tax invoice for the same deal means the customer is billed twice. Continue only if that is intended.</p>
                  <div className="flex justify-end gap-2">
                    <button type="button" onClick={() => setDuplicateWarning('')} className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 font-bold">
                      Do not create
                    </button>
                    <button type="button" disabled={isSubmitting} onClick={() => submit(true)} className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-black disabled:opacity-50">
                      {isSubmitting ? 'Creating…' : 'Create another tax invoice'}
                    </button>
                  </div>
                </div>
              )}

              {/* Document Type Switch */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {(
                  [
                    { id: 'TAX_INVOICE', label: 'GST Tax Invoice (Bill)', icon: Receipt, active: 'bg-blue-50 border-blue-600 text-blue-700' },
                    { id: 'QUOTATION', label: 'Quotation / Estimate', icon: FileText, active: 'bg-purple-50 border-purple-600 text-purple-700' },
                    { id: 'PROFORMA', label: 'Proforma Invoice', icon: FileText, active: 'bg-teal-50 border-teal-600 text-teal-700' },
                  ] as Array<{ id: DocType; label: string; icon: any; active: string }>
                ).map((option) => {
                  const Icon = option.icon;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => { setDocType(option.id); setDuplicateWarning(''); }}
                      className={`py-2.5 px-4 rounded-xl text-xs font-bold border transition-all ${
                        docType === option.id ? `${option.active} shadow-sm` : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <span className="flex items-center justify-center gap-2">
                        <Icon className="h-4 w-4" />
                        <span>{option.label}</span>
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Customer billing details */}
              <div className="space-y-3">
                <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-blue-600" />
                  <span>Bill to</span>
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Company / billing name</label>
                    <input type="text" maxLength={200} value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder={lead.full_name} className={inputClass} />
                  </div>
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Customer GSTIN (if registered)</label>
                    <input
                      type="text"
                      maxLength={15}
                      value={gstin}
                      onChange={(e) => setGstin(e.target.value.toUpperCase().replace(/\s/g, ''))}
                      placeholder="15 characters"
                      className={`${inputClass} font-mono ${gstinError ? 'border-rose-400' : ''}`}
                    />
                    {gstinError && <p className="text-[10px] text-rose-600 mt-1">{gstinError}</p>}
                  </div>
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">
                      State (place of supply) {isBill && <span className="text-rose-500">*</span>}
                    </label>
                    <select
                      value={placeOfSupply}
                      disabled={Boolean(!gstinError && gstinState)}
                      onChange={(e) => setStateCode(e.target.value)}
                      className={`${inputClass} bg-white disabled:bg-slate-100`}
                    >
                      <option value="">-- Select state --</option>
                      {states.map((s) => (
                        <option key={s.code} value={s.code}>{s.name} ({s.code})</option>
                      ))}
                    </select>
                    {!gstinError && gstinState && <p className="text-[10px] text-slate-500 mt-1">Taken from the GSTIN.</p>}
                  </div>
                  <div className="md:col-span-2">
                    <label className="font-semibold text-slate-700 block mb-1">Billing address</label>
                    <input type="text" maxLength={500} value={address} onChange={(e) => setAddress(e.target.value)} className={inputClass} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="font-semibold text-slate-700 block mb-1">City</label>
                      <input type="text" maxLength={100} value={city} onChange={(e) => setCity(e.target.value)} className={inputClass} />
                    </div>
                    <div>
                      <label className="font-semibold text-slate-700 block mb-1">PIN code</label>
                      <input type="text" inputMode="numeric" maxLength={6} value={pincode} onChange={(e) => setPincode(e.target.value.replace(/\D/g, ''))} className={inputClass} />
                    </div>
                  </div>
                </div>
                {taxSplitKnown && (
                  <p className={`text-[11px] font-bold px-3 py-2 rounded-lg border ${interstate ? 'bg-indigo-50 border-indigo-200 text-indigo-800' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`}>
                    {interstate
                      ? `Inter-state supply to ${placeOfSupplyName}: IGST will be charged.`
                      : `Supply within ${placeOfSupplyName}: CGST + SGST will be charged.`}
                  </p>
                )}
              </div>

              {/* Line Items Section */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold text-slate-800">Line Items</h4>
                  <button
                    type="button"
                    onClick={handleAddItem}
                    disabled={items.length >= 100}
                    className="flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-800 bg-blue-50 px-2.5 py-1 rounded-lg border border-blue-200 disabled:opacity-50"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Add Item</span>
                  </button>
                </div>

                <div className="border border-slate-200 rounded-xl overflow-x-auto bg-white shadow-sm">
                  <table className="w-full text-left text-xs min-w-[760px]">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                      <tr>
                        <th className="p-2.5">Item / Service</th>
                        <th className="p-2.5 w-24">HSN/SAC{isBill ? ' *' : ''}</th>
                        <th className="p-2.5 w-20">Qty</th>
                        <th className="p-2.5 w-20">Unit</th>
                        <th className="p-2.5 w-28">Rate (₹)</th>
                        <th className="p-2.5 w-20">Disc %</th>
                        <th className="p-2.5 w-20">GST %</th>
                        <th className="p-2.5 w-28 text-right">Amount (₹)</th>
                        <th className="p-2.5 w-10"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {items.map((row, idx) => {
                        const rowBase = Number(row.quantity || 0) * Number(row.unit_price || 0);
                        const rowNet = rowBase - (rowBase * Number(row.discount_percentage || 0)) / 100;
                        const rowTotal = rowNet + (rowNet * Number(row.gst_rate || 0)) / 100;

                        return (
                          <tr key={idx} className="hover:bg-slate-50/50 align-top">
                            <td className="p-2">
                              {productsList.length > 0 && (
                                <select
                                  value=""
                                  onChange={(e) => handleSelectCatalogProduct(idx, e.target.value)}
                                  className="w-full mb-1 text-[11px] border border-slate-200 rounded px-1.5 py-0.5 text-slate-500 bg-slate-50"
                                >
                                  <option value="">-- Or choose from catalog --</option>
                                  {productsList.map((p) => (
                                    <option key={p._id} value={p._id}>{p.name} ({money(p.unit_price)})</option>
                                  ))}
                                </select>
                              )}
                              <input type="text" maxLength={300} value={row.name} onChange={(e) => handleItemChange(idx, 'name', e.target.value)} placeholder="Item name or description" className={inputClass} />
                            </td>
                            <td className="p-2">
                              <input
                                type="text"
                                inputMode="numeric"
                                maxLength={8}
                                value={row.hsn_sac_code}
                                onChange={(e) => handleItemChange(idx, 'hsn_sac_code', e.target.value.replace(/\D/g, ''))}
                                placeholder="4-8 digits"
                                className={inputClass}
                              />
                            </td>
                            <td className="p-2">
                              <input type="number" min="0.001" step="any" value={row.quantity} onChange={(e) => handleItemChange(idx, 'quantity', Number(e.target.value))} className={inputClass} />
                            </td>
                            <td className="p-2">
                              <input type="text" maxLength={20} value={row.unit} onChange={(e) => handleItemChange(idx, 'unit', e.target.value)} className={inputClass} />
                            </td>
                            <td className="p-2">
                              <input type="number" min="0" step="any" value={row.unit_price} onChange={(e) => handleItemChange(idx, 'unit_price', Number(e.target.value))} className={inputClass} />
                            </td>
                            <td className="p-2">
                              <input type="number" min="0" max="100" step="any" value={row.discount_percentage} onChange={(e) => handleItemChange(idx, 'discount_percentage', Number(e.target.value))} className={inputClass} />
                            </td>
                            <td className="p-2">
                              <select value={row.gst_rate} onChange={(e) => handleItemChange(idx, 'gst_rate', Number(e.target.value))} className={`${inputClass} bg-white`}>
                                {GST_RATES.map((rate) => (
                                  <option key={rate} value={rate}>{rate}%</option>
                                ))}
                              </select>
                            </td>
                            <td className="p-2 text-right font-bold text-slate-800 whitespace-nowrap">{money(rowTotal)}</td>
                            <td className="p-2 text-center">
                              {items.length > 1 && (
                                <button type="button" onClick={() => handleRemoveItem(idx)} aria-label="Remove item" className="text-slate-400 hover:text-red-600 transition-colors">
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Summary and Financial Totals */}
              <div className="flex flex-col sm:flex-row justify-between items-start gap-4 pt-2">
                <div className="w-full sm:w-1/2 space-y-3 text-xs">
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Due date (optional)</label>
                    <input type="date" min={todayIso()} value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={`${inputClass} max-w-[200px]`} />
                  </div>
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Notes for the customer</label>
                    <textarea rows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Shown on the document" className="w-full border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500" />
                  </div>
                </div>
                <div className="w-full sm:w-80 bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2 text-xs">
                  {totals.discount > 0 && (
                    <div className="flex justify-between text-slate-500">
                      <span>Discount:</span>
                      <span>- {money(totals.discount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-slate-600">
                    <span>Taxable Subtotal:</span>
                    <span className="font-semibold text-slate-800">{money(totals.taxable)}</span>
                  </div>
                  {taxSplitKnown && !interstate ? (
                    <>
                      <div className="flex justify-between text-slate-600">
                        <span>CGST:</span>
                        <span className="font-semibold text-slate-800">{money(totals.tax / 2)}</span>
                      </div>
                      <div className="flex justify-between text-slate-600">
                        <span>SGST:</span>
                        <span className="font-semibold text-slate-800">{money(totals.tax / 2)}</span>
                      </div>
                    </>
                  ) : (
                    <div className="flex justify-between text-slate-600">
                      <span>{taxSplitKnown ? 'IGST:' : 'GST:'}</span>
                      <span className="font-semibold text-slate-800">{money(totals.tax)}</span>
                    </div>
                  )}
                  {Math.abs(totals.roundOff) >= 0.005 && (
                    <div className="flex justify-between text-slate-500">
                      <span>Round off:</span>
                      <span>{money(totals.roundOff)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm font-bold text-slate-900 pt-2 border-t border-slate-200">
                    <span>Grand Total:</span>
                    <span className="text-blue-700">{money(totals.grand)}</span>
                  </div>
                  <p className="text-[10px] text-slate-400">Preview only. The final figures are calculated by the server.</p>
                </div>
              </div>

              {problems.length > 0 && (
                <ul className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-[11px] list-disc pl-6 space-y-0.5">
                  {problems.slice(0, 6).map((problem) => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {!createdInvoice && (
          <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-200/70 transition-colors">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => submit(false)}
              disabled={isSubmitting || problems.length > 0 || Boolean(duplicateWarning)}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-500/20 transition-all disabled:opacity-50"
            >
              <Receipt className="h-4 w-4" />
              <span>{isSubmitting ? 'Generating...' : `Generate ${documentLabel(docType)}`}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
