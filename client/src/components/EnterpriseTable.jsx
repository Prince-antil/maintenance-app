import { useMemo, useState } from 'react';
import {
  ChevronUp, ChevronDown, ChevronLeft, ChevronRight,
  Search, FileSpreadsheet, Printer,
} from 'lucide-react';
import { exportToCSV } from '../utils.js';
import EmptyState from './EmptyState.jsx';

/**
 * Enterprise data table.
 * - Sticky glassmorphic header, zebra striping, hover rows
 * - Column sorting, instant search, dropdown filters
 * - Client-side pagination
 * - Export to Excel (CSV) / PDF (print)
 *
 * columns: [{ key, label, sortable, render?, value?, className?, hideBelow? }]
 * filters: [{ key, label, options: [..], value, onChange }]
 */
export default function EnterpriseTable({
  columns,
  rows,
  loading = false,
  filters = [],
  searchKeys = [],
  pageSize = 10,
  exportName = 'ccpl-report',
  emptyTitle = 'No reports uploaded yet',
  emptyDescription,
  emptyActionLabel,
  onEmptyAction,
}) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState({ key: null, dir: 'asc' });
  const [page, setPage] = useState(1);

  const processed = useMemo(() => {
    let out = [...rows];
    if (search.trim() && searchKeys.length) {
      const q = search.toLowerCase();
      out = out.filter((r) =>
        searchKeys.some((k) => String(r[k] ?? '').toLowerCase().includes(q))
      );
    }
    if (sort.key) {
      out.sort((a, b) => {
        const av = a[sort.key] ?? '';
        const bv = b[sort.key] ?? '';
        const cmp = typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av).localeCompare(String(bv), undefined, { numeric: true });
        return sort.dir === 'asc' ? cmp : -cmp;
      });
    }
    return out;
  }, [rows, search, searchKeys, sort]);

  const totalPages = Math.max(1, Math.ceil(processed.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = processed.slice((safePage - 1) * pageSize, safePage * pageSize);

  const toggleSort = (key) => {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  };

  const handleExportCSV = () => {
    exportToCSV(
      processed,
      columns.map((c) => ({ key: c.key, label: c.label, value: c.value })),
      `${exportName}.csv`
    );
  };

  const handleExportPDF = () => {
    window.print();
  };

  return (
    <div className="glass-card overflow-hidden print-area">
      {/* Toolbar: search + filters + export */}
      <div className="p-4 flex flex-col gap-3 border-b border-white/[0.06]">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" aria-hidden="true" />
            <input
              type="search"
              className="input-field pl-9 text-sm"
              placeholder="Search in table..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              aria-label="Search in table"
            />
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <button onClick={handleExportCSV} className="btn-ghost inline-flex items-center gap-1.5 text-xs" aria-label="Export to Excel">
              <FileSpreadsheet size={13} aria-hidden="true" /> Export Excel
            </button>
            <button onClick={handleExportPDF} className="btn-ghost inline-flex items-center gap-1.5 text-xs" aria-label="Export to PDF">
              <Printer size={13} aria-hidden="true" /> Export PDF
            </button>
          </div>
        </div>
        {filters.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {filters.map((f) => (
              <select
                key={f.key}
                className="select-field text-xs"
                value={f.value}
                onChange={(e) => { f.onChange(e.target.value); setPage(1); }}
                aria-label={`Filter by ${f.label}`}
              >
                <option value="">{f.label}</option>
                {f.options.map((o) => (
                  <option key={typeof o === 'object' ? o.value : o} value={typeof o === 'object' ? o.value : o}>
                    {typeof o === 'object' ? o.label : o}
                  </option>
                ))}
              </select>
            ))}
          </div>
        )}
      </div>

      {/* Table body */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" role="status" aria-label="Loading" />
        </div>
      ) : processed.length === 0 ? (
        <div className="p-4">
          <EmptyState
            title={emptyTitle}
            description={emptyDescription}
            actionLabel={emptyActionLabel}
            onAction={onEmptyAction}
          />
        </div>
      ) : (
        <>
          <div className="overflow-x-auto max-h-[62vh]">
            <table className="enterprise-table">
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th
                      key={c.key}
                      className={`${c.hideBelow || ''} ${c.sortable ? 'cursor-pointer hover:text-white' : ''}`}
                      onClick={c.sortable ? () => toggleSort(c.key) : undefined}
                      aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                      scope="col"
                    >
                      <span className="inline-flex items-center gap-1">
                        {c.label}
                        {c.sortable && sort.key === c.key && (
                          sort.dir === 'asc'
                            ? <ChevronUp size={12} aria-hidden="true" />
                            : <ChevronDown size={12} aria-hidden="true" />
                        )}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row, i) => (
                  <tr key={row.id || i}>
                    {columns.map((c) => (
                      <td key={c.key} className={`${c.hideBelow || ''} ${c.className || ''}`}>
                        {c.render ? c.render(row) : row[c.key]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-white/[0.06]">
            <p className="text-meta">
              {(safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, processed.length)} of {processed.length} records
            </p>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={safePage === 1}
                className="w-8 h-8 rounded-control border border-white/10 flex items-center justify-center text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                aria-label="Previous page"
              >
                <ChevronLeft size={14} aria-hidden="true" />
              </button>
              <span className="text-xs text-slate-400 px-2">
                Page <span className="text-white font-semibold">{safePage}</span> / {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={safePage === totalPages}
                className="w-8 h-8 rounded-control border border-white/10 flex items-center justify-center text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                aria-label="Next page"
              >
                <ChevronRight size={14} aria-hidden="true" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
