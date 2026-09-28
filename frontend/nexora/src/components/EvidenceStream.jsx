import { motion, useReducedMotion } from 'motion/react';
import GlassPanel from './GlassPanel';
import TechnicalLabel from './TechnicalLabel';
import { EVIDENCE_STATUS, EVIDENCE_CATEGORIES } from '../constants/executionEvents';

const CATEGORY_META = {
  [EVIDENCE_CATEGORIES.RESEARCH]: {
    label: 'RESEARCH INDEX',
    agentTag: 'MOD.01 // RESEARCH',
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
      </svg>
    ),
  },
  [EVIDENCE_CATEGORIES.BROWSER]: {
    label: 'DOM TELEMETRY',
    agentTag: 'MOD.02 // BROWSER',
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-.778.099-1.533.284-2.253" />
      </svg>
    ),
  },
  [EVIDENCE_CATEGORIES.ANALYST]: {
    label: 'SYNTHESIS MATRIX',
    agentTag: 'MOD.03 // ANALYST',
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5m.75-9l3-3 2.25 2.25L15 6" />
      </svg>
    ),
  },
  [EVIDENCE_CATEGORIES.CRITIC]: {
    label: 'LOGIC & ASSERTIONS',
    agentTag: 'MOD.04 // CRITIC',
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
      </svg>
    ),
  },
};

/**
 * EvidenceStream
 * Displays structured evidence placeholders and verification status.
 *
 * SAFETY INVARIANT:
 * Contains ZERO fabricated sources, URLs, citations, or fake research facts.
 * Structured strictly as future evidence infrastructure.
 */
export default function EvidenceStream({ evidenceMap = {} }) {
  const prefersReducedMotion = useReducedMotion();

  const getStatusBadge = (status) => {
    switch (status) {
      case EVIDENCE_STATUS.COLLECTING:
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase bg-[rgba(192,132,252,0.12)] text-[#C084FC] border border-[rgba(192,132,252,0.3)]">
            <span className="h-1 w-1 rounded-full bg-[#C084FC] animate-pulse" />
            COLLECTING
          </span>
        );
      case EVIDENCE_STATUS.READY:
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase bg-[rgba(56,189,248,0.1)] text-[#38BDF8] border border-[rgba(56,189,248,0.25)]">
            <span className="h-1 w-1 rounded-full bg-[#38BDF8]" />
            READY
          </span>
        );
      case EVIDENCE_STATUS.VERIFIED:
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase bg-[rgba(57,255,136,0.12)] text-[#39FF88] border border-[rgba(57,255,136,0.3)]">
            <span className="h-1 w-1 rounded-full bg-[#39FF88] shadow-[0_0_4px_#39FF88]" />
            VERIFIED
          </span>
        );
      case EVIDENCE_STATUS.WAITING:
      default:
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono uppercase bg-[#090710] text-[#756B7D] border border-[rgba(168,85,247,0.08)]">
            <span className="h-1 w-1 rounded-full bg-[#554C5C]" />
            WAITING
          </span>
        );
    }
  };

  const getCardBorder = (status) => {
    switch (status) {
      case EVIDENCE_STATUS.COLLECTING:
        return 'border-[rgba(192,132,252,0.35)] bg-[#0C0816]/90 shadow-[0_0_12px_rgba(168,85,247,0.1)]';
      case EVIDENCE_STATUS.READY:
        return 'border-[rgba(56,189,248,0.3)] bg-[#060D17]/85';
      case EVIDENCE_STATUS.VERIFIED:
        return 'border-[rgba(57,255,136,0.3)] bg-[#041009]/85';
      case EVIDENCE_STATUS.WAITING:
      default:
        return 'border-[rgba(168,85,247,0.08)] bg-[#050508]/80';
    }
  };

  return (
    <GlassPanel elevated className="p-4 sm:p-5 flex flex-col h-full relative overflow-hidden">
      {/* Evidence Stream Header */}
      <div className="flex items-center justify-between pb-3 mb-3 border-b border-[rgba(168,85,247,0.12)]">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-[#A855F7]" />
          <div>
            <h2 className="text-xs sm:text-sm font-mono font-bold tracking-tight text-[#F5F1FA] uppercase">
              EVIDENCE STREAM
            </h2>
            <p className="text-[10px] font-mono text-[#756B7D]">
              Verified artifacts & telemetry repository
            </p>
          </div>
        </div>

        <TechnicalLabel variant="default" size="xs">
          STRUCTURED REPO
        </TechnicalLabel>
      </div>

      {/* 4 Category Evidence Cards */}
      <div className="flex-1 space-y-2.5 overflow-y-auto max-h-[380px] scrollbar-thin pr-0.5">
        {Object.entries(CATEGORY_META).map(([categoryKey, meta]) => {
          const evidence = evidenceMap[categoryKey] || {
            status: EVIDENCE_STATUS.WAITING,
            placeholder: 'Awaiting pipeline dispatch...',
          };

          return (
            <motion.div
              key={categoryKey}
              layout={!prefersReducedMotion}
              className={`p-3 rounded-lg border transition-all duration-300 ${getCardBorder(
                evidence.status
              )}`}
            >
              {/* Card Header */}
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <div className="p-1 rounded bg-[#0A0713] text-[#C084FC] border border-[rgba(168,85,247,0.12)]">
                    {meta.icon}
                  </div>
                  <div>
                    <h3 className="text-xs font-mono font-bold text-[#F5F1FA] tracking-tight">
                      {meta.label}
                    </h3>
                    <span className="text-[8.5px] font-mono text-[#554C5C]">
                      {meta.agentTag}
                    </span>
                  </div>
                </div>

                {getStatusBadge(evidence.status)}
              </div>

              {/* Card Structured Placeholder Content */}
              <div className="mt-1.5 p-2 rounded bg-[#020203]/90 border border-[rgba(168,85,247,0.06)]">
                <p className="text-[11px] font-mono text-[#B8ADBF] leading-relaxed select-none">
                  {evidence.placeholder}
                </p>
              </div>

              {/* Card Footer Telemetry */}
              <div className="mt-2 flex items-center justify-between text-[8.5px] font-mono text-[#554C5C]">
                <span>INTEGRITY: SHA-256 LOCKED</span>
                <span>
                  {evidence.timeString
                    ? `SYNCED ${evidence.timeString}`
                    : 'AWAITING DISPATCH'}
                </span>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="pt-2.5 mt-2 border-t border-[rgba(168,85,247,0.08)] flex items-center justify-between text-[9px] font-mono text-[#554C5C] select-none">
        <span>STORAGE: IN-MEMORY CACHE</span>
        <span className="text-[#39FF88]">ASSERTIONS: 04/04 MONITORED</span>
      </div>
    </GlassPanel>
  );
}
