import React, { useEffect, useState } from 'react';
import { Product, api } from '../services/api';
import { Package, Plus, X, Tag } from 'lucide-react';

export const ProductsPage: React.FC = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);

  // Form
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [hsn, setHsn] = useState('');
  const [unit, setUnit] = useState('Nos');
  const [price, setPrice] = useState<number>(1000);
  const [gstRate, setGstRate] = useState<number>(18);
  const [isSaving, setIsSaving] = useState(false);

  const loadProducts = () => {
    setLoading(true);
    api.getProducts()
      .then((res) => {
        if (Array.isArray(res)) setProducts(res);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    loadProducts();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || price <= 0) return;

    setIsSaving(true);
    try {
      await api.createProduct(undefined, {
        name,
        sku: sku || undefined,
        hsn_sac_code: hsn || undefined,
        unit,
        unit_price: Number(price),
        gst_rate: Number(gstRate),
      });
      setShowAddModal(false);
      setName('');
      setSku('');
      setHsn('');
      setPrice(1000);
      loadProducts();
    } catch (err) {
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

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

        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-500/20 transition-all"
        >
          <Plus className="h-4 w-4" />
          <span>Add Product / Service</span>
        </button>
      </div>

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
              <div className="flex items-start justify-between">
                <div>
                  <h4 className="font-bold text-sm text-slate-900">{p.name}</h4>
                  <span className="text-[10px] text-slate-400">SKU: {p.sku || 'N/A'}</span>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                  {p.gst_rate}% GST
                </span>
              </div>

              <div className="flex items-center justify-between text-xs pt-2 border-t border-slate-100">
                <span className="text-slate-500">HSN/SAC: <strong className="text-slate-700">{p.hsn_sac_code || '-'}</strong></span>
                <span className="text-slate-500">Unit: <strong className="text-slate-700">{p.unit}</strong></span>
              </div>

              <div className="pt-2 flex items-baseline justify-between border-t border-slate-100">
                <span className="text-xs text-slate-400 font-medium">Standard Price:</span>
                <span className="text-base font-extrabold text-blue-700">
                  ₹{Number(p.unit_price).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Add Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <h3 className="font-bold text-base text-slate-900">Add Item to Catalog</h3>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreate} className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Product / Service Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. CNC Lathe Machine - Heavy Duty"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">HSN / SAC Code</label>
                  <input
                    type="text"
                    placeholder="e.g. 8458"
                    value={hsn}
                    onChange={(e) => setHsn(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Unit</label>
                  <select
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs bg-white text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="Nos">Nos (Number)</option>
                    <option value="Pcs">Pcs (Pieces)</option>
                    <option value="Kg">Kg (Kilogram)</option>
                    <option value="Hours">Hours (Services)</option>
                    <option value="Mtrs">Mtrs (Meters)</option>
                    <option value="Box">Box</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Unit Price (₹) *</label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={price}
                    onChange={(e) => setPrice(Number(e.target.value))}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500 font-bold"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">GST Rate Slab</label>
                  <select
                    value={gstRate}
                    onChange={(e) => setGstRate(Number(e.target.value))}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs bg-white text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500 font-bold"
                  >
                    <option value="0">0% (Exempt)</option>
                    <option value="5">5%</option>
                    <option value="12">12%</option>
                    <option value="18">18% Standard</option>
                    <option value="28">28%</option>
                  </select>
                </div>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-5 py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-sm disabled:opacity-50"
                >
                  {isSaving ? 'Saving...' : 'Save Product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
