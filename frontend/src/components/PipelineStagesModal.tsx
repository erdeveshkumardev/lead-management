import React, { useState } from 'react';
import { PipelineStage, api } from '../services/api';
import { 
  X, 
  Plus, 
  Trash2, 
  ArrowUp, 
  ArrowDown, 
  Sliders, 
  Sparkles,
  CheckCircle2
} from 'lucide-react';

interface PipelineStagesModalProps {
  tenantId: string;
  initialStages: PipelineStage[];
  onClose: () => void;
  onSaved: () => void;
}

const COLOR_OPTIONS = [
  { id: 'blue', label: 'Blue', bg: 'bg-blue-50 text-blue-700 border-blue-200' },
  { id: 'amber', label: 'Amber', bg: 'bg-amber-50 text-amber-700 border-amber-200' },
  { id: 'indigo', label: 'Indigo', bg: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  { id: 'purple', label: 'Purple', bg: 'bg-purple-50 text-purple-700 border-purple-200' },
  { id: 'orange', label: 'Orange', bg: 'bg-orange-50 text-orange-700 border-orange-200' },
  { id: 'emerald', label: 'Emerald', bg: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  { id: 'rose', label: 'Rose', bg: 'bg-rose-50 text-rose-700 border-rose-200' },
  { id: 'slate', label: 'Slate', bg: 'bg-slate-100 text-slate-700 border-slate-300' },
];

export const PipelineStagesModal: React.FC<PipelineStagesModalProps> = ({
  tenantId,
  initialStages,
  onClose,
  onSaved,
}) => {
  const [stages, setStages] = useState<PipelineStage[]>(
    initialStages.length > 0 ? [...initialStages] : []
  );
  const [newStageLabel, setNewStageLabel] = useState('');
  const [newStageColor, setNewStageColor] = useState('blue');
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleAddStage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStageLabel.trim()) return;

    const id = newStageLabel.toUpperCase().trim().replace(/[^A-Z0-9]+/g, '_');
    // Ensure unique ID
    const exists = stages.some((s) => s.id === id);
    const finalId = exists ? `${id}_${Date.now().toString().slice(-4)}` : id;

    const newStage: PipelineStage = {
      id: finalId,
      label: newStageLabel.trim(),
      color: newStageColor,
      order: stages.length,
    };

    setStages([...stages, newStage]);
    setNewStageLabel('');
  };

  const handleRemoveStage = (index: number) => {
    if (stages.length <= 1) {
      setErrorMsg('You must have at least one stage in the pipeline.');
      return;
    }
    const updated = stages.filter((_, idx) => idx !== index);
    setStages(updated);
  };

  const handleMove = (index: number, direction: 'up' | 'down') => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === stages.length - 1) return;

    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    const updated = [...stages];
    const temp = updated[index];
    updated[index] = updated[targetIndex];
    updated[targetIndex] = temp;
    setStages(updated);
  };

  const handleUpdateLabel = (index: number, newLabel: string) => {
    const updated = [...stages];
    updated[index].label = newLabel;
    setStages(updated);
  };

  const handleUpdateColor = (index: number, newColor: string) => {
    const updated = [...stages];
    updated[index].color = newColor;
    setStages(updated);
  };

  const handleSave = async () => {
    setIsSaving(true);
    setErrorMsg('');
    try {
      await api.updatePipelineStages(tenantId, stages);
      onSaved();
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to save custom stages.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-2xl w-full p-6 space-y-5 max-h-[92vh] flex flex-col text-slate-900">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-200">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <Sliders className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-base text-slate-900">Customize Sales Pipeline Stages</h3>
              <p className="text-xs text-slate-500">
                Configure custom stages that match your company's sales process.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        {errorMsg && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs">
            {errorMsg}
          </div>
        )}

        {/* Existing Stages List */}
        <div className="overflow-y-auto flex-1 space-y-2.5 pr-1 kanban-col text-xs">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
            Stages Order ({stages.length} Columns in Kanban)
          </span>

          {stages.map((stage, idx) => {
            return (
              <div
                key={stage.id}
                className="p-3 rounded-2xl border border-slate-200 bg-slate-50/70 flex items-center gap-2.5 hover:bg-slate-50 transition-colors"
              >
                {/* Index Pill */}
                <span className="h-6 w-6 rounded-lg bg-slate-200 text-slate-700 font-bold flex items-center justify-center text-xs shrink-0">
                  {idx + 1}
                </span>

                {/* Stage Label input */}
                <input
                  type="text"
                  value={stage.label}
                  onChange={(e) => handleUpdateLabel(idx, e.target.value)}
                  className="flex-1 border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-bold text-slate-800 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />

                {/* Stage Color Picker */}
                <select
                  value={stage.color}
                  onChange={(e) => handleUpdateColor(idx, e.target.value)}
                  className="w-24 border border-slate-200 rounded-xl px-2 py-1.5 text-xs bg-white text-slate-800 capitalize font-medium"
                >
                  {COLOR_OPTIONS.map((col) => (
                    <option key={col.id} value={col.id}>{col.label}</option>
                  ))}
                </select>

                {/* Move buttons */}
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleMove(idx, 'up')}
                    disabled={idx === 0}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 disabled:opacity-30"
                    title="Move Up"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMove(idx, 'down')}
                    disabled={idx === stages.length - 1}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 disabled:opacity-30"
                    title="Move Down"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* Delete button */}
                <button
                  type="button"
                  onClick={() => handleRemoveStage(idx)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50"
                  title="Remove Stage"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            );
          })}
        </div>

        {/* Add New Stage Row */}
        <form onSubmit={handleAddStage} className="pt-3 border-t border-slate-200 flex items-center gap-2 text-xs">
          <input
            type="text"
            placeholder="e.g. Site Visit Scheduled, Sample Sent..."
            value={newStageLabel}
            onChange={(e) => setNewStageLabel(e.target.value)}
            className="flex-1 border border-slate-200 rounded-xl px-3 py-2 bg-slate-50 focus:bg-white text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <select
            value={newStageColor}
            onChange={(e) => setNewStageColor(e.target.value)}
            className="w-24 border border-slate-200 rounded-xl px-2 py-2 bg-slate-50 text-slate-800 capitalize"
          >
            {COLOR_OPTIONS.map((col) => (
              <option key={col.id} value={col.id}>{col.label}</option>
            ))}
          </select>
          <button
            type="submit"
            disabled={!newStageLabel.trim()}
            className="flex items-center gap-1 px-4 py-2 rounded-xl font-bold bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Add</span>
          </button>
        </form>

        {/* Footer */}
        <div className="pt-3 border-t border-slate-200 flex items-center justify-between">
          <span className="text-[11px] text-slate-400">Stages update for all team members instantly.</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="px-5 py-2.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-500/20 disabled:opacity-50"
            >
              {isSaving ? 'Saving...' : 'Save Pipeline Stages'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
