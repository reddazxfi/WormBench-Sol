import React from 'react';
import { AlertTriangle, Info, XCircle, Wrench } from 'lucide-react';
import type { LuaFinding } from '../utils/luaCheck';

interface LuaFindingsProps {
  findings: LuaFinding[];
  /**
   * Applies one mechanical rewrite. Only the custom Lua box can be written
   * back, so the generated-file view leaves the fix as advice.
   */
  onFix?: (finding: LuaFinding) => void;
  /** How many rows to show before the rest are summarised. */
  limit?: number;
  className?: string;
}

/**
 * The report `checkLua` returns, as rows. Nothing renders when the code is
 * clean: a green tick on every weapon is noise, a finding is the message.
 *
 * The three bands are `wbcheck`'s, because the same finding has to look the same
 * in both tools: `error` is a red banner (the code raises or desyncs), `warning`
 * is amber, and `info` is a neutral advisory (`pairs()`, a nil an `or` already
 * covers) which is why an advisories-only file keeps the quiet border. A row
 * inside a block the editor did not generate is tagged instead of re-levelled:
 * the rule and severity are still the compiler's, and what it adds is that the
 * block cannot be trusted to declare what it reads.
 */
export const LuaFindings: React.FC<LuaFindingsProps> = ({
  findings,
  onFix,
  limit = 6,
  className = '',
}) => {
  if (findings.length === 0) return null;
  const errors = findings.filter((f) => f.severity === 'error').length;
  const warnings = findings.filter((f) => f.severity === 'warning').length;
  const infos = findings.length - errors - warnings;
  // A finding inside a block the editor did not generate is about code no panel
  // produced, which is the case `notGenerated` exists for: the severity stays the
  // compiler's, but the reader is told the file cannot declare what it reads.
  const notGenerated = findings.filter((f) => f.notGenerated).length;
  const shown = findings.slice(0, limit);
  const rest = findings.length - shown.length;

  const counts = [
    errors > 0 ? `${errors} blocking issue${errors === 1 ? '' : 's'}` : '',
    warnings > 0 ? `${warnings} warning${warnings === 1 ? '' : 's'}` : '',
    infos > 0 ? `${infos} advisor${infos === 1 ? 'y' : 'ies'}` : '',
    notGenerated > 0 ? `${notGenerated} in code the editor did not generate` : '',
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <div
      className={`space-y-1.5 rounded-xl border p-3 ${
        errors > 0
          ? 'border-rose-200 bg-rose-50/70 dark:border-rose-900/60 dark:bg-rose-950/30'
          : warnings > 0
            ? 'border-amber-200 bg-amber-50/70 dark:border-amber-900/60 dark:bg-amber-950/30'
            : 'border-stone-200 bg-stone-50/70 dark:border-stone-700 dark:bg-stone-900/40'
      } ${className}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span
          className={`text-xs font-semibold ${
            errors > 0
              ? 'text-rose-800 dark:text-rose-200'
              : warnings > 0
                ? 'text-amber-800 dark:text-amber-200'
                : 'text-stone-600 dark:text-stone-300'
          }`}
        >
          {counts}
        </span>
        <span className="text-[10px] text-stone-500 dark:text-stone-400">
          the same rules the compiler checks
        </span>
      </div>
      <ul className="space-y-1">
        {shown.map((finding, index) => (
          <li
            key={`${finding.rule}-${finding.line}-${index}`}
            className="flex items-start gap-2 text-[11px] leading-snug text-stone-700 dark:text-stone-300"
          >
            {finding.severity === 'error' ? (
              <XCircle className="mt-0.5 h-3 w-3 shrink-0 text-rose-500" aria-hidden="true" />
            ) : finding.severity === 'warning' ? (
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" aria-hidden="true" />
            ) : (
              <Info className="mt-0.5 h-3 w-3 shrink-0 text-stone-400" aria-hidden="true" />
            )}
            <span className="shrink-0 font-mono text-stone-500 dark:text-stone-400">
              line {finding.line}
            </span>
            <span className="min-w-0">
              {finding.message}
              <span className="ml-1.5 whitespace-nowrap font-mono text-[10px] text-stone-400 dark:text-stone-500">
                [{finding.rule}]
              </span>
              {finding.notGenerated && (
                <span
                  className="ml-1.5 whitespace-nowrap rounded-sm bg-stone-200 px-1 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wide text-stone-600 dark:bg-stone-700 dark:text-stone-300"
                  title="This line is custom Lua or a hook an imported bundle put there: the editor did not generate it, and nothing else in the file declares what it reads."
                >
                  custom
                </span>
              )}
            </span>
            {onFix && finding.fix && (
              <button
                type="button"
                onClick={() => onFix(finding)}
                className="ml-auto flex shrink-0 items-center gap-1 rounded-md border border-stone-300 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-stone-700 hover:bg-stone-100 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700"
                title={`Rewrite ${finding.fix.from} to ${finding.fix.to}`}
              >
                <Wrench className="h-2.5 w-2.5" aria-hidden="true" />
                Fix
              </button>
            )}
          </li>
        ))}
      </ul>
      {rest > 0 && (
        <p className="text-[10px] text-stone-500 dark:text-stone-400">
          {rest} more finding{rest === 1 ? '' : 's'} in this file.
        </p>
      )}
      {notGenerated > 0 && (
        <p className="text-[10px] leading-snug text-stone-600 dark:text-stone-300">
          A finding marked <span className="font-mono">custom</span> is inside code the editor did
          not generate: your custom Lua, or a hook an imported bundle put there. Nothing in the file
          declares those names, so it fails when the hook runs. Edit the custom Lua before exporting.
        </p>
      )}
    </div>
  );
};
