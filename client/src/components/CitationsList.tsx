import React from 'react';
import { FileText, CheckCircle } from 'lucide-react';

export interface SourceCitation {
  docId: string;
  docTitle: string;
  sectionTitle: string;
}

interface Props {
  sources: SourceCitation[];
}

export const CitationsList: React.FC<Props> = ({ sources }) => {
  if (!sources || sources.length === 0) return null;

  return (
    <div className="mt-3 pt-3 border-t border-slate-100">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
        <FileText className="w-3.5 h-3.5 text-slate-400" />
        Verified Grounded Policy Citations
      </div>
      <div className="flex flex-wrap gap-2">
        {sources.map((src, idx) => (
          <div
            key={idx}
            className="flex items-center gap-1.5 bg-slate-50 border border-slate-200/90 rounded-md px-2.5 py-1 text-xs text-slate-700 shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
          >
            <CheckCircle className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            <span className="font-semibold text-slate-900">{src.docId}</span>
            <span className="text-slate-400">·</span>
            <span className="truncate max-w-[220px]" title={`${src.docTitle} — ${src.sectionTitle}`}>
              {src.sectionTitle}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
