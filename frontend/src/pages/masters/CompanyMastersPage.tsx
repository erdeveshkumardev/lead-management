import React, { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { 
  Sliders, 
  Flame, 
  Share2, 
  XCircle, 
  PhoneCall, 
  Megaphone, 
  Users2, 
  Plus, 
  Trash2, 
  Save, 
  CheckCircle2,
  Clock,
  Building2,
  ShieldCheck
} from 'lucide-react';

interface CompanyMastersPageProps {
  tenantId?: string;
}

export const CompanyMastersPage: React.FC<CompanyMastersPageProps> = ({ tenantId }) => {
  const activeTenant = tenantId || 'demo_tenant_01';
  const [activeTab, setActiveTab] = useState<'categories' | 'sources' | 'lost_reasons' | 'follow_ups' | 'campaigns' | 'org'>('categories');
  const [masters, setMasters] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  // Local editable states
  const [categories, setCategories] = useState<any[]>([]);
  const [sources, setSources] = useState<any[]>([]);
  const [lostReasons, setLostReasons] = useState<string[]>([]);
  const [followUps, setFollowUps] = useState<any[]>([]);
  const [campaigns, setCampaigns] = useState<string[]>([]);
  const [departments, setDepartments] = useState<string[]>([]);
  const [designations, setDesignations] = useState<string[]>([]);

  // Simple input helpers for new additions
  const [newText, setNewText] = useState('');
  const [newExtra, setNewExtra] = useState('');

  const loadMasters = () => {
    setLoading(true);
    api.getCompanyMasters(activeTenant)
      .then((res) => {
        setMasters(res);
        setCategories(res.lead_categories || []);
        setSources(res.lead_sources || [
          { id: 'indiamart', label: 'IndiaMART Marketplace', is_active: true },
          { id: 'tradeindia', label: 'TradeIndia B2B', is_active: true },
          { id: 'facebook', label: 'Meta / Facebook Ads', is_active: true },
          { id: 'justdial', label: 'Justdial Lead Push', is_active: true },
          { id: 'website', label: 'Website Inquiry Form', is_active: true },
          { id: 'google_ads', label: 'Google Search Ads', is_active: true },
          { id: 'referral', label: 'Direct Referral / Walk-in', is_active: true },
        ]);
        setLostReasons(res.lost_reasons || []);
        setFollowUps(res.follow_up_types || []);
        setCampaigns(res.campaigns || []);
        setDepartments(res.departments || []);
        setDesignations(res.designations || []);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
      });
  };

  useEffect(() => {
    loadMasters();
  }, [activeTenant]);

  const handleSaveAll = async () => {
    setSaving(true);
    try {
      const payload = {
        lead_categories: categories,
        lead_sources: sources,
        lost_reasons: lostReasons,
        follow_up_types: followUps,
        campaigns: campaigns,
        departments: departments,
        designations: designations
      };
      await api.updateCompanyMasters(activeTenant, payload);
      setSuccessMsg('Company CRM Masters saved successfully!');
      setTimeout(() => setSuccessMsg(''), 3500);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  // Add Item to active tab
  const handleAddNewItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newText.trim()) return;

    if (activeTab === 'categories') {
      const id = newText.toUpperCase().trim().replace(/[^A-Z0-9]+/g, '_');
      setCategories([...categories, { id, label: newText.trim(), color: newExtra || 'blue', sla_hours: 24 }]);
    } else if (activeTab === 'sources') {
      const id = newText.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_');
      setSources([...sources, { id, label: newText.trim(), is_active: true }]);
    } else if (activeTab === 'lost_reasons') {
      setLostReasons([...lostReasons, newText.trim()]);
    } else if (activeTab === 'follow_ups') {
      const id = newText.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_');
      setFollowUps([...followUps, { id, label: newText.trim(), icon: 'phone' }]);
    } else if (activeTab === 'campaigns') {
      setCampaigns([...campaigns, newText.trim()]);
    } else if (activeTab === 'org') {
      if (newExtra === 'designation') {
        setDesignations([...designations, newText.trim()]);
      } else {
        setDepartments([...departments, newText.trim()]);
      }
    }

    setNewText('');
    setNewExtra('');
  };

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900">Company CRM Masters & Standards</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Configure company-level sales classifications: Hot/Warm/Cold categories, Lost Reasons, Follow-up channels & campaigns.
          </p>
        </div>

        <button
          onClick={handleSaveAll}
          disabled={saving}
          className="flex items-center gap-2 px-6 py-2.5 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-lg shadow-indigo-600/30 transition-all transform hover:-translate-y-0.5 disabled:opacity-50"
        >
          <Save className="h-4 w-4" />
          <span>{saving ? 'Saving...' : 'Save CRM Masters'}</span>
        </button>
      </div>

      {successMsg && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-2xl text-emerald-800 text-xs flex items-center gap-2 shadow-sm">
          <CheckCircle2 className="h-5 w-5 text-emerald-600 flex-shrink-0" />
          <span className="font-bold">{successMsg}</span>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto text-xs font-bold kanban-col pb-2 border-b border-slate-200">
        <button
          onClick={() => setActiveTab('categories')}
          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl transition-all ${
            activeTab === 'categories' ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
          }`}
        >
          <Flame className="h-3.5 w-3.5 text-rose-300" />
          <span>Lead Category (Hot/Warm/Cold)</span>
        </button>

        <button
          onClick={() => setActiveTab('sources')}
          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl transition-all ${
            activeTab === 'sources' ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
          }`}
        >
          <Share2 className="h-3.5 w-3.5" />
          <span>Lead Sources</span>
        </button>

        <button
          onClick={() => setActiveTab('lost_reasons')}
          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl transition-all ${
            activeTab === 'lost_reasons' ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
          }`}
        >
          <XCircle className="h-3.5 w-3.5 text-red-300" />
          <span>Lost Reasons</span>
        </button>

        <button
          onClick={() => setActiveTab('follow_ups')}
          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl transition-all ${
            activeTab === 'follow_ups' ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
          }`}
        >
          <PhoneCall className="h-3.5 w-3.5" />
          <span>Follow-up Types</span>
        </button>

        <button
          onClick={() => setActiveTab('campaigns')}
          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl transition-all ${
            activeTab === 'campaigns' ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
          }`}
        >
          <Megaphone className="h-3.5 w-3.5" />
          <span>Campaigns</span>
        </button>

        <button
          onClick={() => setActiveTab('org')}
          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl transition-all ${
            activeTab === 'org' ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
          }`}
        >
          <Users2 className="h-3.5 w-3.5" />
          <span>Departments & Roles</span>
        </button>
      </div>

      {/* Main Content Area */}
      <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200/80 shadow-sm space-y-6 text-xs text-slate-900">
        {/* TAB 1: Lead Category Master */}
        {activeTab === 'categories' && (
          <div className="space-y-4">
            <div>
              <h3 className="font-bold text-sm text-slate-900">Lead Category Master (Hot, Warm, Cold)</h3>
              <p className="text-[11px] text-slate-500">Configure response SLA hours and closing probability tags.</p>
            </div>

            <div className="space-y-3">
              {categories.map((cat, idx) => (
                <div key={idx} className="p-4 rounded-2xl border border-slate-200 bg-slate-50/70 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <span className={`h-8 w-8 rounded-xl font-bold flex items-center justify-center text-xs ${
                      cat.color === 'rose' ? 'bg-rose-100 text-rose-700 border border-rose-200' :
                      cat.color === 'amber' ? 'bg-amber-100 text-amber-700 border border-amber-200' :
                      'bg-blue-100 text-blue-700 border border-blue-200'
                    }`}>
                      {cat.id.charAt(0)}
                    </span>
                    <div>
                      <h4 className="font-bold text-slate-900">{cat.label}</h4>
                      <p className="text-[11px] text-slate-500 font-mono">Code: {cat.id} • SLA: {cat.sla_hours} Hours Response Limit</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-slate-500 font-semibold">SLA:</span>
                    <input
                      type="number"
                      value={cat.sla_hours}
                      onChange={(e) => {
                        const copy = [...categories];
                        copy[idx].sla_hours = Number(e.target.value);
                        setCategories(copy);
                      }}
                      className="w-16 border border-slate-200 rounded-lg px-2 py-1 text-center font-bold"
                    />
                    <button
                      onClick={() => setCategories(categories.filter((_, i) => i !== idx))}
                      className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 2: Lead Sources Master */}
        {activeTab === 'sources' && (
          <div className="space-y-4">
            <div>
              <h3 className="font-bold text-sm text-slate-900">Lead Source Channels Master</h3>
              <p className="text-[11px] text-slate-500">Enable or add channels from where leads flow into your system.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {sources.map((src, idx) => (
                <div key={idx} className="p-3.5 rounded-2xl border border-slate-200 bg-slate-50 flex items-center justify-between">
                  <div>
                    <h5 className="font-bold text-slate-800">{src.label}</h5>
                    <span className="text-[10px] text-slate-400 font-mono">id: {src.id}</span>
                  </div>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <span className="text-[10px] text-slate-500 font-semibold">{src.is_active ? 'Active' : 'Disabled'}</span>
                    <input
                      type="checkbox"
                      checked={src.is_active ?? true}
                      onChange={(e) => {
                        const copy = [...sources];
                        copy[idx].is_active = e.target.checked;
                        setSources(copy);
                      }}
                      className="rounded text-indigo-600 focus:ring-0 h-4 w-4"
                    />
                  </label>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 3: Lost Reasons Master */}
        {activeTab === 'lost_reasons' && (
          <div className="space-y-4">
            <div>
              <h3 className="font-bold text-sm text-slate-900">Deal Lost Reasons Master</h3>
              <p className="text-[11px] text-slate-500">Standard reasons captured when a sales executive marks an opportunity as Lost.</p>
            </div>

            <div className="space-y-2">
              {lostReasons.map((reason, idx) => (
                <div key={idx} className="p-3 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="h-6 w-6 rounded-md bg-slate-200 text-slate-700 font-bold flex items-center justify-center text-[11px]">
                      {idx + 1}
                    </span>
                    <span className="font-bold text-slate-800">{reason}</span>
                  </div>
                  <button
                    onClick={() => setLostReasons(lostReasons.filter((_, i) => i !== idx))}
                    className="p-1 text-slate-400 hover:text-red-600"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 4: Follow-up Types Master */}
        {activeTab === 'follow_ups' && (
          <div className="space-y-4">
            <div>
              <h3 className="font-bold text-sm text-slate-900">Follow-up & Interaction Types Master</h3>
              <p className="text-[11px] text-slate-500">Channels used to follow up with leads (WhatsApp, Phone Call, Email, Meeting, Site Visit).</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {followUps.map((fu, idx) => (
                <div key={idx} className="p-3.5 rounded-2xl border border-slate-200 bg-slate-50 flex items-center justify-between">
                  <div>
                    <h5 className="font-bold text-slate-800">{fu.label}</h5>
                    <span className="text-[10px] text-slate-400 font-mono">tag: {fu.id}</span>
                  </div>
                  <button
                    onClick={() => setFollowUps(followUps.filter((_, i) => i !== idx))}
                    className="p-1 text-slate-400 hover:text-red-600"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 5: Campaigns Master */}
        {activeTab === 'campaigns' && (
          <div className="space-y-4">
            <div>
              <h3 className="font-bold text-sm text-slate-900">Marketing Campaigns Master</h3>
              <p className="text-[11px] text-slate-500">Tag incoming inquiries to campaigns to measure marketing ROI.</p>
            </div>

            <div className="space-y-2">
              {campaigns.map((camp, idx) => (
                <div key={idx} className="p-3 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-between">
                  <span className="font-bold text-slate-800">{camp}</span>
                  <button
                    onClick={() => setCampaigns(campaigns.filter((_, i) => i !== idx))}
                    className="p-1 text-slate-400 hover:text-red-600"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 6: Organization Departments & Designations */}
        {activeTab === 'org' && (
          <div className="space-y-6">
            <div className="space-y-3">
              <h4 className="font-bold text-xs uppercase tracking-wider text-slate-500">Departments</h4>
              <div className="flex flex-wrap gap-2">
                {departments.map((dept, idx) => (
                  <span key={idx} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 text-slate-800 font-bold border border-slate-200">
                    <span>{dept}</span>
                    <button onClick={() => setDepartments(departments.filter((_, i) => i !== idx))} className="text-slate-400 hover:text-red-600">✕</button>
                  </span>
                ))}
              </div>
            </div>

            <div className="space-y-3 pt-3 border-t border-slate-100">
              <h4 className="font-bold text-xs uppercase tracking-wider text-slate-500">Designations</h4>
              <div className="flex flex-wrap gap-2">
                {designations.map((desig, idx) => (
                  <span key={idx} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-50 text-indigo-700 font-bold border border-indigo-200">
                    <span>{desig}</span>
                    <button onClick={() => setDesignations(designations.filter((_, i) => i !== idx))} className="text-slate-400 hover:text-red-600">✕</button>
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Add item row */}
        <form onSubmit={handleAddNewItem} className="pt-4 border-t border-slate-200 flex items-center gap-2">
          <input
            type="text"
            required
            placeholder={`Add new ${activeTab.replace('_', ' ')}...`}
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            className="flex-1 border border-slate-200 rounded-xl px-3 py-2 bg-slate-50 focus:bg-white text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />

          {activeTab === 'categories' && (
            <select
              value={newExtra}
              onChange={(e) => setNewExtra(e.target.value)}
              className="border border-slate-200 rounded-xl px-2 py-2 bg-slate-50 text-slate-800"
            >
              <option value="rose">Rose (Hot)</option>
              <option value="amber">Amber (Warm)</option>
              <option value="blue">Blue (Cold)</option>
            </select>
          )}

          {activeTab === 'org' && (
            <select
              value={newExtra}
              onChange={(e) => setNewExtra(e.target.value)}
              className="border border-slate-200 rounded-xl px-2 py-2 bg-slate-50 text-slate-800"
            >
              <option value="department">Department</option>
              <option value="designation">Designation</option>
            </select>
          )}

          <button
            type="submit"
            className="flex items-center gap-1 px-4 py-2 rounded-xl font-bold bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Add</span>
          </button>
        </form>
      </div>
    </div>
  );
};
