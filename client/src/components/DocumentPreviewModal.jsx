import { useEffect } from 'react';
import { X, Download, FileText, ExternalLink } from 'lucide-react';
import { EXT_META } from '../constants.js';

const OFFICE_EXTS = ['.doc', '.docx', '.xlsx', '.xls', '.ppt', '.pptx', '.csv'];
const VIDEO_EXTS = ['.mp4', '.webm', '.mov'];

/**
 * In-app document previewer — embedded PDF viewer + Office Docs Viewer
 * wrapper so .docx / .xlsx / .pptx / .pdf preview in-browser at 85vh.
 */
export default function DocumentPreviewModal({ file, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!file) return null;

  const ext = (file.file_format || '.' + (file.filename?.split('.').pop() || '')).toLowerCase();
  const extMeta = EXT_META[ext];
  const isDataUrl = file.file_url?.startsWith('data:');
  const absoluteUrl = isDataUrl ? file.file_url : new URL(file.file_url, window.location.origin).href;

  let viewer = null;
  if (ext === '.pdf') {
    viewer = (
      <iframe
        src={`${file.file_url}#toolbar=1&view=FitH`}
        title={`Preview: ${file.filename}`}
        className="w-full h-full rounded-b-card bg-white"
      />
    );
  } else if (VIDEO_EXTS.includes(ext)) {
    viewer = (
      <video src={file.file_url} controls className="w-full h-full bg-black rounded-b-card" aria-label={`Video: ${file.filename}`} />
    );
  } else if (OFFICE_EXTS.includes(ext) && !isDataUrl) {
    // Microsoft Office Docs Viewer wrapper (requires a publicly reachable URL)
    viewer = (
      <iframe
        src={`https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(absoluteUrl)}`}
        title={`Preview: ${file.filename}`}
        className="w-full h-full rounded-b-card bg-white"
      />
    );
  } else {
    viewer = (
      <div className="w-full h-full flex flex-col items-center justify-center gap-4 text-center px-6">
        <FileText size={40} className="text-slate-600" aria-hidden="true" />
        <p className="text-body max-w-sm">
          Inline preview is not available for this file. Use the download button to open it locally.
        </p>
        <a href={file.file_url} download={file.filename} className="btn-primary inline-flex items-center gap-2">
          <Download size={15} aria-hidden="true" /> Download File
        </a>
      </div>
    );
  }

  return (
    <div
      className="modal-overlay"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label={`Document preview: ${file.filename}`}
    >
      <div className="modal-content glass-card w-full max-w-5xl flex flex-col overflow-hidden" style={{ height: '85vh' }}>
        {/* Viewer header */}
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-white/[0.08] flex-shrink-0">
          <FileText size={17} className="text-cyan-400 flex-shrink-0" aria-hidden="true" />
          <p className="text-white text-sm font-semibold truncate flex-1" title={file.filename}>{file.filename}</p>
          {extMeta && <span className={`badge ${extMeta.badge}`}>{extMeta.label}</span>}
          <a
            href={file.file_url}
            download={file.filename}
            className="btn-ghost inline-flex items-center gap-1.5 !py-1.5 !px-3 text-xs"
            aria-label="Download file"
          >
            <Download size={13} aria-hidden="true" /> Download File
          </a>
          {!isDataUrl && (
            <a
              href={file.file_url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-ghost inline-flex items-center gap-1.5 !py-1.5 !px-3 text-xs hidden sm:inline-flex"
              aria-label="Open in new tab"
            >
              <ExternalLink size={13} aria-hidden="true" /> Open
            </a>
          )}
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-control flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
            aria-label="Close preview"
          >
            <X size={17} aria-hidden="true" />
          </button>
        </div>
        {/* Viewer body */}
        <div className="flex-1 min-h-0 bg-slate-900/60">{viewer}</div>
      </div>
    </div>
  );
}
