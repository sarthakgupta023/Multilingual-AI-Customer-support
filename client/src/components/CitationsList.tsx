import React from 'react';
import { BookOpen, CheckCircle2 } from 'lucide-react';

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
    <div className="mt-3 pt-3 border-t border-slate-700/50">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
        <BookOpen className="w-3.5 h-3.5 text-indigo-400" />
        Verified Grounded Sources
      </div>
      <div className="flex flex-wrap gap-2">
        {sources.map((src, idx) => (
          <div
            key={idx}
            className="flex items-center gap-1.5 bg-slate-800/90 border border-indigo-500/30 rounded-lg px-2.5 py-1 text-xs text-indigo-200 shadow-sm"
          >
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="font-semibold text-slate-300">[{src.docId}]</span>
            <span className="truncate max-w-[200px]" title={`${src.docTitle} - ${src.sectionTitle}`}>
              {src.sectionTitle}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
