import { useState, useMemo, useRef, useEffect } from 'react';
import { useStore, addPlantSection } from '../store.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useUI } from '../context/UIContext.jsx';
import { getAllSections } from '../constants.js';
import { Plus, X, Check } from 'lucide-react';

/**
 * Reusable Plant Section dropdown with inline "Add New Section" capability.
 *
 * Props:
 *   value        — currently selected section string
 *   onChange     — callback(newSection: string)
 *   id           — optional HTML id for the select
 *   className    — optional extra CSS classes
 *   showAddNew   — show the "+ Add New" option (default true for admin)
 *   ariaLabel    — accessible label
 */
export default function SectionSelect({
  value = '',
  onChange,
  id,
  className = 'select-field',
  showAddNew = true,
  ariaLabel = 'Filter by section',
}) {
  const { user } = useAuth();
  const { pushToast } = useUI();
  const store = useStore();
  const isAdmin = user?.role === 'admin';
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const inputRef = useRef(null);

  const allSections = useMemo(
    () => getAllSections(store.plantSections),
    [store.plantSections]
  );

  useEffect(() => {
    if (adding && inputRef.current) inputRef.current.focus();
  }, [adding]);

  const handleAdd = () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    const ok = addPlantSection(trimmed, user?.full_name || 'Admin');
    if (ok) {
      pushToast({ type: 'success', title: 'Section added', message: `"${trimmed}" is now available in all section dropdowns.` });
      onChange?.(trimmed);
    } else {
      pushToast({ type: 'warning', title: 'Section exists', message: `"${trimmed}" already exists.` });
    }
    setNewName('');
    setAdding(false);
  };

  const handleAddKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); handleAdd(); }
    if (e.key === 'Escape') { setAdding(false); setNewName(''); }
  };

  if (adding) {
    return (
      <div className="flex items-center gap-1.5">
        <input
          ref={inputRef}
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={handleAddKeyDown}
          placeholder="Type new section name..."
          className={`${className} !pr-8 flex-1`}
          aria-label="New section name"
        />
        <button
          type="button"
          onClick={handleAdd}
          className="text-emerald-400 hover:text-emerald-300 p-1"
          aria-label="Confirm add section"
        >
          <Check size={15} />
        </button>
        <button
          type="button"
          onClick={() => { setAdding(false); setNewName(''); }}
          className="text-slate-400 hover:text-white p-1"
          aria-label="Cancel add section"
        >
          <X size={15} />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <select
        id={id}
        className={className}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        aria-label={ariaLabel}
      >
        <option value="">Select section...</option>
        {allSections.map((section) => (
          <option key={section} value={section}>{section}</option>
        ))}
      </select>
      {showAddNew && isAdmin && (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="text-cyan-400 hover:text-cyan-300 p-1 flex-shrink-0"
          aria-label="Add new plant section"
          title="Add new section"
        >
          <Plus size={15} />
        </button>
      )}
    </div>
  );
}
