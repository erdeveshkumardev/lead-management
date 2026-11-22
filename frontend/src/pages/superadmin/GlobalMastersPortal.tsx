import React, { useEffect, useState } from 'react';
import { api, apiMessage, isApiError } from '../../services/api';
import { ConfirmModal } from '../../components/ConfirmModal';
import { 
  Globe, 
  MapPin, 
  Building2, 
  Briefcase, 
  Plus, 
  Trash2, 
  CheckCircle2, 
  Search,
  Sliders,
  ShieldCheck
} from 'lucide-react';

export const GlobalMastersPortal: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'state' | 'industry' | 'city' | 'country'>('state');
  const [mastersData, setMastersData] = useState<Record<string, any[]>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Add Item State
  const [showAddModal, setShowAddModal] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [extraVal1, setExtraVal1] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const loadGlobalMasters = () => {
    setLoading(true);
    api.getGlobalMasters()
      .then((res) => {
        setMastersData(res || {});
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
      });
  };

  useEffect(() => {
    loadGlobalMasters();
  }, []);

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCode || !newName) return;
    setIsSubmitting(true);
    try {
      const extra: Record<string, any> = {};
      if (activeTab === 'state') extra.gst_code = newCode;
      if (activeTab === 'country') extra.phone_code = extraVal1 || '+91';
      if (activeTab === 'city') extra.state = extraVal1 || 'Gujarat';

      const res = await api.createGlobalMaster({
        master_type: activeTab,
        code: newCode.trim(),
        name: newName.trim(),
        extra_data: extra,
        display_order: (mastersData[activeTab]?.length || 0) + 1
      });
      if (isApiError(res)) {
        setShowAddModal(false);
        setErrorMsg(apiMessage(res, 'The record could not be created.'));
        return;
      }
      setErrorMsg('');

      setShowAddModal(false);
      setNewCode('');
      setNewName('');
      setExtraVal1('');
      setSuccessMsg(`New ${activeTab.toUpperCase()} master record created!`);
      loadGlobalMasters();
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const [deletingItemId, setDeletingItemId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDeleteItem = (itemId: string) => {
    setDeletingItemId(itemId);
  };

  const confirmDeleteItem = async () => {
    if (!deletingItemId) return;
    setIsDeleting(true);
    try {
      const res = await api.deleteGlobalMaster(deletingItemId);
      setDeletingItemId(null);
      if (isApiError(res)) {
        setErrorMsg(apiMessage(res, 'The record could not be deleted.'));
        return;
      }
      setErrorMsg('');
      loadGlobalMasters();
    } catch (err) {
      console.error(err);
    } finally {
      setIsDeleting(false);
    }
  };

  const currentList = (mastersData[activeTab] || []).filter((item) =>
    String(item.name || '').toLowerCase().includes(search.toLowerCase()) ||
    String(item.code || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Top Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 rounded-3xl p-6 sm:p-8 text-white border border-indigo-500/20 shadow-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-500/20 border border-indigo-400/30 text-indigo-300 text-xs font-semibold mb-2">
            <ShieldCheck className="h-3.5 w-3.5 text-indigo-400" />
            <span>Super Admin Platform Authority</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
            Global Masters Management Center
          </h1>
          <p className="text-xs sm:text-sm text-slate-300 mt-1 max-w-2xl">
            Standardized geographic, Indian GST state codes, and industry templates used across all multi-tenant company workspaces.
          </p>
        </div>

        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-lg shadow-indigo-600/30 transition-all transform hover:-translate-y-0.5"
        >
          <Plus className="h-4 w-4" />
          <span>Add New Record</span>
        </button>
      </div>

      {errorMsg && (
        <div role="alert" className="p-3.5 bg-rose-50 border border-rose-200 rounded-2xl text-rose-700 text-xs flex items-center gap-2 shadow-sm">
          <span className="font-bold flex-1">{errorMsg}</span>
          <button onClick={() => setErrorMsg('')} className="font-bold text-rose-500 hover:text-rose-800">Dismiss</button>
        </div>
      )}

      {successMsg && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-2xl text-emerald-800 text-xs flex items-center gap-2 shadow-sm">
          <CheckCircle2 className="h-5 w-5 text-emerald-600 flex-shrink-0" />
          <span className="font-bold">{successMsg}</span>
        </div>
      )}

      {/* Navigation Tabs for Super Admin Masters */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-slate-200">
        <div className="flex items-center gap-2 overflow-x-auto text-xs font-bold kanban-col pb-1">
          <button
            onClick={() => { setActiveTab('state'); setSearch(''); }}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl border transition-all ${
              activeTab === 'state'
                ? 'bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-600/20'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            }`}
          >
            <MapPin className="h-4 w-4" />
            <span>State & GST Codes ({mastersData['state']?.length || 0})</span>
          </button>

          <button
            onClick={() => { setActiveTab('industry'); setSearch(''); }}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl border transition-all ${
              activeTab === 'industry'
                ? 'bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-600/20'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            }`}
          >
            <Briefcase className="h-4 w-4" />
            <span>Industry Master ({mastersData['industry']?.length || 0})</span>
          </button>

          <button
            onClick={() => { setActiveTab('city'); setSearch(''); }}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl border transition-all ${
              activeTab === 'city'
                ? 'bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-600/20'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            }`}
          >
            <Building2 className="h-4 w-4" />
            <span>City Master ({mastersData['city']?.length || 0})</span>
          </button>

          <button
            onClick={() => { setActiveTab('country'); setSearch(''); }}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl border transition-all ${
              activeTab === 'country'
                ? 'bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-600/20'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            }`}
          >
            <Globe className="h-4 w-4" />
            <span>Country Master ({mastersData['country']?.length || 0})</span>
          </button>
        </div>

        {/* Search Input */}
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder={`Search in ${activeTab}...`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
      </div>

      {/* Master Items Table */}
      <div className="bg-white rounded-3xl border border-slate-200/80 shadow-sm overflow-hidden">
        {loading ? (
          <div className="py-20 text-center text-slate-400 text-xs">Loading global master records...</div>
        ) : currentList.length === 0 ? (
          <div className="py-20 text-center text-slate-400 text-xs space-y-2">
            <Sliders className="h-8 w-8 mx-auto text-slate-300" />
            <p>No records found in this master.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="p-4">Code / Identifier</th>
                  <th className="p-4">Name / Title</th>
                  <th className="p-4">Metadata & Compliance Details</th>
                  <th className="p-4 text-center">Status</th>
                  <th className="p-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {currentList.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="p-4 font-mono font-bold text-slate-900">
                      <span className="bg-slate-100 text-slate-800 px-2.5 py-1 rounded-lg border border-slate-200">
                        {item.code}
                      </span>
                    </td>

                    <td className="p-4 font-bold text-sm text-slate-900">
                      {item.name}
                    </td>

                    <td className="p-4 text-slate-600">
                      {activeTab === 'state' && (
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-slate-400">GST Code:</span>
                          <span className="font-mono font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200">
                            {item.extra_data?.gst_code || item.code}
                          </span>
                          <span className="text-slate-400 ml-2">(Used in Tax Invoices)</span>
                        </div>
                      )}
                      {activeTab === 'country' && (
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-400">Dial Code:</span>
                          <span className="font-mono font-bold text-slate-800">{item.extra_data?.phone_code || '+91'}</span>
                          <span className="font-semibold text-slate-400 ml-2">Currency:</span>
                          <span className="font-bold text-emerald-700">{item.extra_data?.currency || 'INR'}</span>
                        </div>
                      )}
                      {activeTab === 'city' && (
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-slate-400">State:</span>
                          <span className="font-bold text-slate-800">{item.extra_data?.state || 'India'}</span>
                        </div>
                      )}
                      {activeTab === 'industry' && (
                        <span className="text-[11px] text-slate-500">
                          Preconfigured template for company onboarding
                        </span>
                      )}
                    </td>

                    <td className="p-4 text-center">
                      <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                        Active
                      </span>
                    </td>

                    <td className="p-4 text-right">
                      <button
                        onClick={() => handleDeleteItem(item.id)}
                        className="p-1.5 rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                        title="Delete Record"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add Master Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-md w-full p-6 space-y-4 text-slate-900 text-xs">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <h3 className="font-bold text-base text-slate-900 capitalize">Add New {activeTab} Master</h3>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>

            <form onSubmit={handleAddItem} className="space-y-3.5">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  {activeTab === 'state' ? '2-Digit GST Code (e.g. 24)' : activeTab === 'country' ? 'ISO Code (e.g. IN)' : 'Code / Slug'} *
                </label>
                <input
                  type="text"
                  required
                  placeholder={activeTab === 'state' ? '24' : 'e.g. MH'}
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 font-mono uppercase"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Name / Title *</label>
                <input
                  type="text"
                  required
                  placeholder={activeTab === 'state' ? 'e.g. Gujarat' : 'Title'}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2"
                />
              </div>

              {activeTab === 'city' && (
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Associated State</label>
                  <input
                    type="text"
                    placeholder="e.g. Gujarat"
                    value={extraVal1}
                    onChange={(e) => setExtraVal1(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2"
                  />
                </div>
              )}

              {activeTab === 'country' && (
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Phone Calling Code</label>
                  <input
                    type="text"
                    placeholder="e.g. +91"
                    value={extraVal1}
                    onChange={(e) => setExtraVal1(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2"
                  />
                </div>
              )}

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 rounded-xl font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-md disabled:opacity-50"
                >
                  {isSubmitting ? 'Saving...' : 'Add Record'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modern React Confirmation Modal for Master Record Deletion */}
      <ConfirmModal
        isOpen={Boolean(deletingItemId)}
        title="Delete Master Item?"
        message="Are you sure you want to delete this master record? This action will remove it from global dropdown selections."
        confirmText="Delete Record"
        cancelText="Cancel"
        variant="danger"
        isLoading={isDeleting}
        onConfirm={confirmDeleteItem}
        onCancel={() => setDeletingItemId(null)}
      />
    </div>
  );
};
