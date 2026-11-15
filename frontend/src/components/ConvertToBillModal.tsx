import React, { useState, useEffect } from 'react';
import { Lead, Product, api } from '../services/api';
import { 
  X, 
  Plus, 
  Trash2, 
  Receipt, 
  FileText, 
  CheckCircle2, 
  Download,
  AlertCircle
} from 'lucide-react';

interface ConvertToBillModalProps {
  lead: Lead;
  onClose: () => void;
  onSuccess: () => void;
}

interface ItemRow {
  name: string;
  hsn_sac_code: string;
  quantity: number;
  unit: string;
  unit_price: number;
  discount_percentage: number;
  gst_rate: number;
}

export const ConvertToBillModal: React.FC<ConvertToBillModalProps> = ({
  lead,
  onClose,
  onSuccess,
}) => {
  const [docType, setDocType] = useState<'TAX_INVOICE' | 'QUOTATION'>('TAX_INVOICE');
  const [productsList, setProductsList] = useState<Product[]>([]);
  const [dueDate, setDueDate] = useState<string>('');
  const [notes, setNotes] = useState<string>('Thank you for doing business with us.');
  const [items, setItems] = useState<ItemRow[]>([
    {
      name: lead.product_inquired || 'Standard Product / Service',
      hsn_sac_code: '8458',
      quantity: 1,
      unit: 'Nos',
      unit_price: lead.deal_value > 0 ? Number(lead.deal_value) : 10000,
      discount_percentage: 0,
      gst_rate: 18,
    },
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createdInvoice, setCreatedInvoice] = useState<any>(null);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    // Load products catalog
    api.getProducts().then((res) => {
      if (Array.isArray(res)) setProductsList(res);
    }).catch(() => {});
  }, []);

  const handleAddItem = () => {
    setItems([
      ...items,
      {
        name: '',
        hsn_sac_code: '',
        quantity: 1,
        unit: 'Nos',
        unit_price: 0,
        discount_percentage: 0,
        gst_rate: 18,
      },
    ]);
  };

  const handleRemoveItem = (index: number) => {
    if (items.length > 1) {
      setItems(items.filter((_, i) => i !== index));
    }
  };

  const handleItemChange = (index: number, field: keyof ItemRow, value: any) => {
    const updated = [...items];
    updated[index] = { ...updated[index], [field]: value };
    setItems(updated);
  };

  const handleSelectCatalogProduct = (index: number, productId: string) => {
    const prod = productsList.find((p) => p._id === productId);
    if (prod) {
      const updated = [...items];
      updated[index] = {
        ...updated[index],
        name: prod.name,
        hsn_sac_code: prod.hsn_sac_code || '',
        unit: prod.unit || 'Nos',
        unit_price: Number(prod.unit_price),
        gst_rate: Number(prod.gst_rate || 18),
      };
      setItems(updated);
    }
  };

  // Live calculations
  let subtotal = 0;
  let totalTax = 0;
  items.forEach((item) => {
    const base = item.quantity * item.unit_price;
    const disc = (base * item.discount_percentage) / 100;
    const taxable = base - disc;
    const tax = (taxable * item.gst_rate) / 100;
    subtotal += taxable;
    totalTax += tax;
  });
  const grandTotal = subtotal + totalTax;

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setErrorMessage('');
    try {
      const payload = {
        document_type: docType,
        due_date: dueDate ? dueDate : undefined,
        notes,
        items: items.map((itm) => ({
          name: itm.name || 'Item',
          hsn_sac_code: itm.hsn_sac_code,
          quantity: Number(itm.quantity),
          unit: itm.unit,
          unit_price: Number(itm.unit_price),
          discount_percentage: Number(itm.discount_percentage),
          gst_rate: Number(itm.gst_rate),
        })),
      };

      const res = await api.convertLeadToBill(lead._id, payload, lead.tenant_id);
      if (res.status === 'success') {
        setCreatedInvoice(res.invoice);
        onSuccess();
      } else {
        const detailMsg = typeof res.detail === 'string' ? res.detail : (Array.isArray(res.detail) ? res.detail.map((d: any) => d.msg || JSON.stringify(d)).join(', ') : JSON.stringify(res.detail || ''));
        setErrorMessage(detailMsg || 'Failed to convert lead to bill.');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Error occurred while converting.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-4xl w-full max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center space-x-3">
            <div className="h-10 w-10 rounded-xl bg-blue-600 flex items-center justify-center text-white">
              <Receipt className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Convert Lead to {docType === 'TAX_INVOICE' ? 'GST Tax Invoice' : 'Commercial Quotation'}
              </h3>
              <p className="text-xs text-slate-500">
                Customer: <span className="font-semibold text-slate-700">{lead.full_name}</span> ({lead.company_name || 'Individual'})
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {createdInvoice ? (
            /* Success State */
            <div className="text-center py-8 space-y-4">
              <div className="h-16 w-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle2 className="h-10 w-10" />
              </div>
              <h4 className="text-xl font-bold text-slate-900">
                Bill Generated Successfully!
              </h4>
              <p className="text-sm text-slate-600">
                Invoice Number: <span className="font-bold text-blue-700">{createdInvoice.invoice_number}</span>
              </p>
              <p className="text-xs text-slate-500">
                Lead status has been updated to <span className="font-semibold text-emerald-600">WON</span> and activity logged in timeline.
              </p>
              <div className="pt-4 flex justify-center gap-3">
                <a
                  href={api.getInvoicePdfUrl(createdInvoice._id)}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 text-white font-semibold text-sm hover:bg-blue-700 shadow-md transition-colors"
                >
                  <Download className="h-4 w-4" />
                  <span>Download GST Invoice PDF</span>
                </a>
                <button
                  onClick={onClose}
                  className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-semibold text-sm hover:bg-slate-200 transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          ) : (
            /* Input Form */
            <>
              {errorMessage && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 flex-shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}

              {/* Document Type Switch */}
              <div className="flex gap-4">
                <button
                  type="button"
                  onClick={() => setDocType('TAX_INVOICE')}
                  className={`flex-1 py-2.5 px-4 rounded-xl text-xs font-bold border transition-all ${
                    docType === 'TAX_INVOICE'
                      ? 'bg-blue-50 border-blue-600 text-blue-700 shadow-sm'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-center gap-2">
                    <Receipt className="h-4 w-4" />
                    <span>GST Tax Invoice (Bill)</span>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setDocType('QUOTATION')}
                  className={`flex-1 py-2.5 px-4 rounded-xl text-xs font-bold border transition-all ${
                    docType === 'QUOTATION'
                      ? 'bg-purple-50 border-purple-600 text-purple-700 shadow-sm'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-center gap-2">
                    <FileText className="h-4 w-4" />
                    <span>Commercial Quotation / Estimate</span>
                  </div>
                </button>
              </div>

              {/* Line Items Section */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold text-slate-800">Invoice Line Items</h4>
                  <button
                    type="button"
                    onClick={handleAddItem}
                    className="flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-800 bg-blue-50 px-2.5 py-1 rounded-lg border border-blue-200"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Add Item</span>
                  </button>
                </div>

                <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                      <tr>
                        <th className="p-2.5">Item / Service</th>
                        <th className="p-2.5 w-24">HSN/SAC</th>
                        <th className="p-2.5 w-20">Qty</th>
                        <th className="p-2.5 w-28">Rate (₹)</th>
                        <th className="p-2.5 w-20">GST %</th>
                        <th className="p-2.5 w-28 text-right">Amount (₹)</th>
                        <th className="p-2.5 w-10"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {items.map((row, idx) => {
                        const rowBase = row.quantity * row.unit_price;
                        const rowTax = (rowBase * row.gst_rate) / 100;
                        const rowTotal = rowBase + rowTax;

                        return (
                          <tr key={idx} className="hover:bg-slate-50/50">
                            <td className="p-2">
                              {productsList.length > 0 && (
                                <select
                                  onChange={(e) => handleSelectCatalogProduct(idx, e.target.value)}
                                  className="w-full mb-1 text-[11px] border border-slate-200 rounded px-1.5 py-0.5 text-slate-500 bg-slate-50"
                                >
                                  <option value="">-- Or choose from catalog --</option>
                                  {productsList.map((p) => (
                                    <option key={p._id} value={p._id}>{p.name} (₹{p.unit_price})</option>
                                  ))}
                                </select>
                              )}
                              <input
                                type="text"
                                value={row.name}
                                onChange={(e) => handleItemChange(idx, 'name', e.target.value)}
                                placeholder="Item name or description"
                                className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                              />
                            </td>
                            <td className="p-2">
                              <input
                                type="text"
                                value={row.hsn_sac_code}
                                onChange={(e) => handleItemChange(idx, 'hsn_sac_code', e.target.value)}
                                placeholder="8458"
                                className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                              />
                            </td>
                            <td className="p-2">
                              <input
                                type="number"
                                min="1"
                                value={row.quantity}
                                onChange={(e) => handleItemChange(idx, 'quantity', Number(e.target.value))}
                                className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                              />
                            </td>
                            <td className="p-2">
                              <input
                                type="number"
                                min="0"
                                value={row.unit_price}
                                onChange={(e) => handleItemChange(idx, 'unit_price', Number(e.target.value))}
                                className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                              />
                            </td>
                            <td className="p-2">
                              <select
                                value={row.gst_rate}
                                onChange={(e) => handleItemChange(idx, 'gst_rate', Number(e.target.value))}
                                className="w-full border border-slate-200 rounded-lg px-1.5 py-1.5 text-xs text-slate-800 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                              >
                                <option value="0">0%</option>
                                <option value="5">5%</option>
                                <option value="12">12%</option>
                                <option value="18">18%</option>
                                <option value="28">28%</option>
                              </select>
                            </td>
                            <td className="p-2 text-right font-bold text-slate-800">
                              ₹{rowTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                            </td>
                            <td className="p-2 text-center">
                              {items.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => handleRemoveItem(idx)}
                                  className="text-slate-400 hover:text-red-600 transition-colors"
                                >
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
                <div className="w-full sm:w-1/2 space-y-2">
                  <label className="text-xs font-semibold text-slate-700">Notes / Terms</label>
                  <textarea
                    rows={2}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div className="w-full sm:w-72 bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2 text-xs">
                  <div className="flex justify-between text-slate-600">
                    <span>Taxable Subtotal:</span>
                    <span className="font-semibold text-slate-800">₹{subtotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>GST (CGST+SGST/IGST):</span>
                    <span className="font-semibold text-slate-800">₹{totalTax.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between text-sm font-bold text-slate-900 pt-2 border-t border-slate-200">
                    <span>Grand Total:</span>
                    <span className="text-blue-700">₹{grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {!createdInvoice && (
          <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-200/70 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-500/20 transition-all disabled:opacity-50"
            >
              <Receipt className="h-4 w-4" />
              <span>{isSubmitting ? 'Generating...' : `Generate ${docType === 'TAX_INVOICE' ? 'Tax Invoice' : 'Quotation'}`}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
