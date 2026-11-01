import React from 'react';
import { Zap, Timer } from 'lucide-react';

interface Props {
  ttfaMs: number | null;
  totalMs: number | null;
}

export const LatencyMeter: React.FC<Props> = ({ ttfaMs, totalMs }) => {
  if (ttfaMs === null && totalMs === null) return null;

  return (
    <div className="flex items-center gap-3 text-xs bg-slate-800/60 border border-slate-700/50 rounded-lg px-2.5 py-1 text-slate-400">
      {ttfaMs !== null && (
        <div className="flex items-center gap-1">
          <Zap className="w-3.5 h-3.5 text-amber-400" />
          <span>TTFA:</span>
          <span className="font-mono font-semibold text-amber-300">{ttfaMs}ms</span>
        </div>
      )}
      {totalMs !== null && (
        <div className="flex items-center gap-1 border-l border-slate-700/80 pl-2">
          <Timer className="w-3.5 h-3.5 text-indigo-400" />
          <span>Total:</span>
          <span className="font-mono font-semibold text-indigo-300">{totalMs}ms</span>
        </div>
      )}
    </div>
  );
};
