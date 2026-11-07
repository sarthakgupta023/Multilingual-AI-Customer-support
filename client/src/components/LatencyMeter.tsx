import React from 'react';
import { Clock } from 'lucide-react';

interface Props {
  ttfaMs: number | null;
  totalMs: number | null;
}

export const LatencyMeter: React.FC<Props> = ({ ttfaMs, totalMs }) => {
  if (ttfaMs === null && totalMs === null) return null;

  return (
    <div className="flex items-center gap-2 text-[11px] bg-slate-100 border border-slate-200 rounded-md px-2 py-0.5 text-slate-600 font-mono">
      <Clock className="w-3 h-3 text-slate-400" />
      {ttfaMs !== null && (
        <span>
          TTFA: <strong className="text-slate-900">{ttfaMs}ms</strong>
        </span>
      )}
      {totalMs !== null && (
        <span className="text-slate-400">· Total: <strong className="text-slate-900">{totalMs}ms</strong></span>
      )}
    </div>
  );
};
