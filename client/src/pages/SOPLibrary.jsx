import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store.js';
import { useUI } from '../context/UIContext.jsx';
import { MACHINE_DOC_TABS, EXT_META } from '../constants.js';
import EmptyState from '../components/EmptyState.jsx';
import { getDocumentUrl, toPreviewDocument } from '../lib/documentLinks.js';
import { timeAgo } from '../utils.js';
import {
  BookOpen, Search, Download, ExternalLink, FileText, Filter, Eye,
} from 'lucide-react';

const TAB_LABEL = Object.fromEntries(MACHINE_DOC_TABS.map((t) => [t.id, t.label]));

export default function SOPLibrary() {
  const navigate = useNavigate();
  const store = useStore();
  const { openPreview } = useUI();
  const [search, setSearch] = useState('');
  const [tabF, setTabF] = useState('');
  const [machineF, setMachineF] = useState('');

  // Flatten every machine document into one searchable library
  const allDocs = useMemo(
    () =>
      store.machines.flatMap((m) =>
        (m.docs || []).map((d) => ({ ...d, machineId: m.id, machineName: m.name, section: m.section }))
      ).sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt)),
    [store.machines]
  );

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allDocs.filter(
      (d) =>
        (!q || d.filename.toLowerCase().includes(q) || d.machineName.toLowerCase().includes(q)) &&
        (!tabF || d.tab === tabF) &&
        (!machineF || d.machineId === machineF)
    );
  }, [allDocs, search, tabF, machineF]);

  const counts = useMemo(() => {
    const byTab = {};
    allDocs.forEach((d) => { byTab[d.tab] = (byTab[d.tab] || 0) + 1; });
    return byTab;
  }, [allDocs]);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h2 className="text-page-title flex items-center gap-3">
            <BookOpen size={28} className="text-cyan-400" aria-hidden="true" />
            SOP & Technical Library
          </h2>
          <p className="text-body mt-1.5">
            Every SOP, MOP, manual and circuit diagram uploaded across all machines — {allDocs.length} document{allDocs.length === 1 ? '' : 's'}
          </p>
        </div>
        <button onClick={() => navigate('/machines')} className="btn-primary inline-flex items-center gap-2 text-xs whitespace-nowrap">
          <ExternalLink size={13} aria-hidden="true" /> Machine Register
        </button>
      </div>

      {/* Per-type counters */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {MACHINE_DOC_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTabF(tabF === t.id ? '' : t.id)}
            className={`glass-card p-3.5 text-left transition-all ${tabF === t.id ? '!border-cyan-500/40 bg-cyan-500/5' : 'hover:border-white/[0.14]'}`}
            aria-pressed={tabF === t.id}
          >
            <p className="text-white text-lg font-bold leading-none">{counts[t.id] || 0}</p>
            <p className="text-slate-500 text-[10px] mt-1.5 leading-tight">{t.label}</p>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="glass-card p-4 flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" aria-hidden="true" />
          <input
            type="search"
            className="input-field pl-9"
            placeholder="Search by document or machine name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search documents"
          />
        </div>
        <select className="select-field md:!w-56" value={tabF} onChange={(e) => setTabF(e.target.value)} aria-label="Filter by document type">
          <option value="">All Document Types</option>
          {MACHINE_DOC_TABS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        <select className="select-field md:!w-56" value={machineF} onChange={(e) => setMachineF(e.target.value)} aria-label="Filter by machine">
          <option value="">All Machines</option>
          {store.machines.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </div>

      {/* Library table */}
      <div className="glass-card overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title={allDocs.length === 0 ? 'Library is empty' : 'No documents match your filters'}
              description={allDocs.length === 0
                ? 'Open a machine profile and upload SOPs, manuals or circuit diagrams — they appear here instantly.'
                : 'Try clearing the search or filters.'}
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="enterprise-table w-full min-w-[760px]">
              <thead>
                <tr>
                  <th>Document</th><th>Type</th><th>Machine</th><th>Uploaded By</th><th>Uploaded</th><th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => {
                  const ext = EXT_META[d.file_format] || null;
                  const fileUrl = getDocumentUrl(d);
                  return (
                    <tr key={d.id}>
                      <td>
                        <div className="flex items-center gap-2.5 min-w-0">
                          <FileText size={14} className="text-cyan-400 flex-shrink-0" aria-hidden="true" />
                          <span className="text-white text-xs font-medium truncate max-w-[260px]">{d.filename}</span>
                          {ext && <span className={`badge text-[9px] ${ext.badge}`}>{ext.label}</span>}
                        </div>
                      </td>
                      <td><span className="badge bg-white/[0.05] text-slate-300 border border-white/[0.08]">{TAB_LABEL[d.tab] || d.tab}</span></td>
                      <td>
                        <button onClick={() => navigate(`/machines/${d.machineId}`)} className="text-cyan-400 hover:text-cyan-300 text-xs font-medium transition-colors">
                          {d.machineName}
                        </button>
                      </td>
                      <td className="text-slate-400 text-xs">{d.uploadedBy || '—' }</td>
                      <td className="text-slate-500 text-xs whitespace-nowrap">{timeAgo(d.uploadedAt)}</td>
                      <td className="text-right">
                        <div className="inline-flex items-center gap-1">
                          {fileUrl ? (
                            <>
                              <button onClick={() => openPreview(toPreviewDocument(d))} className="btn-ghost !p-1.5" aria-label={`Preview ${d.filename}`}>
                                <Eye size={13} aria-hidden="true" />
                              </button>
                              <a
                                href={fileUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="btn-ghost !p-1.5 text-cyan-400 hover:text-cyan-300"
                                aria-label={`Download ${d.filename}`}
                              >
                                <Download size={13} aria-hidden="true" />
                              </a>
                            </>
                          ) : (
                            <span className="btn-ghost !p-1.5 opacity-40 cursor-not-allowed" aria-hidden="true">
                              <Download size={13} />
                            </span>
                          )}
                          <button onClick={() => navigate(`/machines/${d.machineId}`)} className="btn-ghost !p-1.5" aria-label={`Open ${d.machineName}`}>
                            <ExternalLink size={13} aria-hidden="true" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-slate-600 text-[10px] flex items-center gap-1.5">
        <Filter size={11} aria-hidden="true" />
        Showing {rows.length} of {allDocs.length} documents · library updates automatically when SOPs are uploaded on any machine profile.
      </p>
    </div>
  );
}
