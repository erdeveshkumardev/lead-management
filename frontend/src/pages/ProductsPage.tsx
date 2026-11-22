import React, { useCallback, useEffect, useState } from 'react';
import { CurrentUser, Product, api, apiMessage, can, isApiError } from '../services/api';
import { ConfirmModal } from '../components/ConfirmModal';
import { GST_RATES } from '../utils/gst';
import { money } from '../utils/billing';
import { AlertCircle, Package, Pencil, Plus, Trash2, X } from 'lucide-react';

interface ProductsPageProps {
  currentUser?: CurrentUser | null;
}

const HSN_RE = /^[0-9]{4,8}$/;
const UNITS = ['Nos', 'Pcs', 'Kg', 'Hours', 'Mtrs', 'Box', 'Set', 'Ltr'];

export const ProductsPage: React.FC<ProductsPageProps> = ({ currentUser }) => {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [toDelete, setToDelete] = useState<Product | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [pageError, setPageError] = useState('');

  // everyone in the company can read the catalogue; only people with this permission can change it
  const canManage = can(currentUser, 'products_manage');

  // Form
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [hsn, setHsn] = useState('');
  const [unit, setUnit] = useState('Nos');
  const [price, setPrice] = useState<string>('');
  const [gstRate, setGstRate] = useState<number>(18);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const loadProducts = useCallback(async () => {
    setLoading(true);
    setProducts(await api.getProducts());
    setLoading(false);
  }, []);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  const openCreate = () => {
    setEditing(null);
    setName('');
    setSku('');
    setHsn('');
    setUnit('Nos');
    setPrice('');
    setGstRate(18);
    setFormError('');
    setShowModal(true);
  };

  const openEdit = (product: Product) => {
    setEditing(product);
    setName(product.name || '');
    setSku(product.sku || '');
    setHsn(product.hsn_sac_code || '');
    setUnit(product.unit || 'Nos');
    setPrice(String(product.unit_price ?? ''));
    setGstRate(Number(product.gst_rate ?? 18));
    setFormError('');
    setShowModal(true);
  };

  const hsnProblem = hsn.trim() && !HSN_RE.test(hsn.trim()) ? 'HSN/SAC code must be 4 to 8 digits.' : '';
  const numericPrice = Number(price);
  const formValid = name.trim().length > 0 && price !== '' && Number.isFinite(numericPrice) && numericPrice >= 0 && !hsnProblem;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formValid || isSaving) return;

    setIsSaving(true);
    setFormError('');
    const payload = {
      name: name.trim(),
      sku: sku.trim() || undefined,
      hsn_sac_code: hsn.trim() || undefined,
      unit,
      unit_price: numericPrice,
      gst_rate: Number(gstRate),
    };
    const res = editing ? await api.updateProduct(editing._id, payload) : await api.createProduct(undefined, payload);
    setIsSaving(false);

    if (isApiError(res)) {
      setFormError(apiMessage(res, 'The item could not be saved.'));
      return;
    }
    setShowModal(false);
    loadProducts();
  };

  const handleDelete = async () => {
    if (!toDelete) return;
    setIsDeleting(true);
    const res = await api.deleteProduct(toDelete._id);
    setIsDeleting(false);
    setToDelete(null);
    if (isApiError(res)) {
      setPageError(apiMessage(res, 'The item could not be deleted.'));
      return;
    }
    setPageError('');
    loadProducts();
  };

  const inputClass = 'w-full border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Products & Services Master</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Maintain your item catalog, HSN/SAC codes, and GST rates for instant quotation & billing.
          </p>
        </div>

        {canManage && (
          <button
            onClick={openCreate}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-500/20 transition-all"
          >
            <Plus className="h-4 w-4" />
            <span>Add Product / Service</span>
          </button>
        )}
      </div>

      {pageError && (
        <div role="alert" className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 text-rose-500" />
          <span>{pageError}</span>
        </div>
      )}

      {/* Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading ? (
          <div className="col-span-3 py-16 text-center text-slate-400 text-sm">Loading catalog...</div>
        ) : products.length === 0 ? (
          <div className="col-span-3 py-16 text-center text-slate-400 text-sm space-y-2 bg-white rounded-2xl border border-slate-200">
            <Package className="h-10 w-10 mx-auto text-slate-300" />
            <p>No products or services in catalog yet.</p>
          </div>
        ) : (
          products.map((p) => (
            <div key={p._id} className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h4 className="font-bold text-sm text-slate-900 break-words">{p.name}</h4>
                  <span className="text-[10px] text-slate-400">SKU: {p.sku || 'N/A'}</span>
                </div>
                <span className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                  {p.gst_rate}% GST
                </span>
              </div>

              <div className="flex items-center justify-between text-xs pt-2 border-t border-slate-100">
                <span className="text-slate-500">HSN/SAC: <strong className="text-slate-700">{p.hsn_sac_code || '-'}</strong></span>
                <span className="text-slate-500">Unit: <strong className="text-slate-700">{p.unit}</strong></span>
              </div>

              <div className="pt-2 flex items-baseline justify-between border-t border-slate-100">
                <span className="text-xs text-slate-400 font-medium">Standard Price:</span>
                <span className="text-base font-extrabold text-blue-700">{money(p.unit_price)}</span>
              </div>

              {!p.hsn_sac_code && (
                <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
                  No HSN/SAC code: it will have to be typed on every tax invoice.
                </p>
              )}

              {canManage && (
                <div className="flex justify-end gap-2 pt-1">
                  <button onClick={() => openEdit(p)} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold border border-slate-200 text-slate-700 hover:bg-slate-50">
                    <Pencil className="h-3 w-3" /> Edit
                  </button>
                  <button onClick={() => setToDelete(p)} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold border border-rose-200 text-rose-700 hover:bg-rose-50">
                    <Trash2 className="h-3 w-3" /> Delete
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <ConfirmModal
        isOpen={Boolean(toDelete)}
        title="Delete this item?"
        message={`"${toDelete?.name || ''}" will be removed from the catalog. Bills that already use it are not changed.`}
        confirmText="Delete item"
        variant="danger"
        isLoading={isDeleting}
        onConfirm={handleDelete}
        onCancel={() => setToDelete(null)}
      />

      {/* Add / edit dialog */}
      {showModal && canManage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-md w-full p-6 space-y-4 my-auto text-slate-900">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <h3 className="font-bold text-base text-slate-900">{editing ? 'Edit Catalog Item' : 'Add Item to Catalog'}</h3>
              <button onClick={() => setShowModal(false)} aria-label="Close" className="text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            {formError && (
              <div role="alert" className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 text-rose-500" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleSave} className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Product / Service Name *</label>
                <input type="text" required maxLength={200} placeholder="e.g. CNC Lathe Machine - Heavy Duty" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">SKU / Item code</label>
                  <input type="text" maxLength={60} value={sku} onChange={(e) => setSku(e.target.value)} className={inputClass} />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">HSN / SAC Code</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={8}
                    placeholder="4-8 digits"
                    value={hsn}
                    onChange={(e) => setHsn(e.target.value.replace(/\D/g, ''))}
                    className={`${inputClass} ${hsnProblem ? 'border-rose-400' : ''}`}
                  />
                  {hsnProblem && <p className="text-[10px] text-rose-600 mt-1">{hsnProblem}</p>}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Unit</label>
                  <select value={unit} onChange={(e) => setUnit(e.target.value)} className={`${inputClass} bg-white`}>
                    {!UNITS.includes(unit) && <option value={unit}>{unit}</option>}
                    {UNITS.map((u) => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Unit Price (₹) *</label>
                  <input type="number" min="0" step="any" required value={price} onChange={(e) => setPrice(e.target.value)} className={`${inputClass} font-bold`} />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">GST Rate</label>
                  <select value={gstRate} onChange={(e) => setGstRate(Number(e.target.value))} className={`${inputClass} bg-white font-bold`}>
                    {GST_RATES.map((rate) => (
                      <option key={rate} value={rate}>{rate}%</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100">
                  Cancel
                </button>
                <button type="submit" disabled={isSaving || !formValid} className="px-5 py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-sm disabled:opacity-50">
                  {isSaving ? 'Saving...' : editing ? 'Save Changes' : 'Save Product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
