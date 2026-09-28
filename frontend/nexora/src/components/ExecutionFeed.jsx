import { useEffect, useRef } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import GlassPanel from './GlassPanel';
import TechnicalLabel from './TechnicalLabel';
import { easings } from '../motion/transitions';

const AGENT_COLORS = {
  CORE: 'text-[#E9D5FF] border-[rgba(233,213,255,0.25)] bg-[#120B20]',
  PLANNER: 'text-[#C084FC] border-[rgba(192,132,252,0.30)] bg-[#0A0713]',
  RESEARCH: 'text-[#38BDF8] border-[rgba(56,189,248,0.30)] bg-[#04111D]',
  BROWSER: 'text-[#818CF8] border-[rgba(129,140,248,0.30)] bg-[#070A1A]',
  ANALYST: 'text-[#C084FC] border-[rgba(192,132,252,0.30)] bg-[#0A0713]',
  CRITIC: 'text-[#F472B6] border-[rgba(244,114,182,0.30)] bg-[#17050E]',
  BUILDER: 'text-[#A78BFA] border-[rgba(167,139,250,0.30)] bg-[#0E0919]',
  QA: 'text-[#39FF88] border-[rgba(57,255,136,0.30)] bg-[#03150A]',
};

/**
 * ExecutionFeed
 * Real-time operational telemetry log visualizing autonomous agent actions.
 *
 * NOTE: Currently consuming deterministic simulation events until backend WebSocket is connected.
 */
export default function ExecutionFeed({
  events = [],
  isSimulating = false,
  isComplete = false,
  onClear,
}) {
  const containerRef = useRef(null);
  const prefersReducedMotion = useReducedMotion();

  // Keep latest events smoothly in view
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTo({
        top: containerRef.current.scrollHeight,
        behavior: prefersReducedMotion ? 'auto' : 'smooth',
      });
    }
  }, [events.length, prefersReducedMotion]);

  const hasEvents = events.length > 0;

  return (
    <GlassPanel elevated className="p-4 sm:p-5 flex flex-col h-full relative overflow-hidden">
      {/* Feed Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 pb-3 mb-3 border-b border-[rgba(168,85,247,0.12)]">
        <div className="flex items-center gap-2.5">
          <span
            className={`h-2 w-2 rounded-full transition-all ${
              isSimulating
                ? 'bg-[#A855F7] shadow-[0_0_8px_#C084FC] animate-pulse'
                : isComplete
                ? 'bg-[#39FF88] shadow-[0_0_8px_#39FF88]'
                : 'bg-[#554C5C]'
            }`}
          />
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xs sm:text-sm font-mono font-bold tracking-tight text-[#F5F1FA] uppercase">
                MISSION EXECUTION // LIVE
              </h2>
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#120B20] text-[#C084FC] border border-[rgba(168,85,247,0.2)]">
                SIMULATED ORCHESTRATOR
              </span>
            </div>
            <p className="text-[10px] font-mono text-[#756B7D]">
              Autonomous event stream • Invariant verification telemetry
            </p>
          </div>
        </div>

        {/* Right Status Controls */}
        <div className="flex items-center gap-2 self-end sm:self-center">
          <TechnicalLabel
            variant={isSimulating ? 'primary' : isComplete ? 'success' : 'default'}
            size="xs"
          >
            {isSimulating ? 'STREAM ACTIVE' : isComplete ? 'PIPELINE LOCKED' : 'STREAM STANDBY'}
          </TechnicalLabel>
          <span className="text-[9px] font-mono text-[#554C5C]">
            {events.length} EVENTS
          </span>
        </div>
      </div>

      {/* Event Stream Body */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto space-y-2 pr-1 min-h-[260px] max-h-[380px] scrollbar-thin"
      >
        <AnimatePresence initial={false}>
          {!hasEvents ? (
            <motion.div
              key="empty-stream"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="h-full flex flex-col items-center justify-center text-center py-12 px-4"
            >
              <div className="h-8 w-8 rounded-full bg-[#050508] border border-[rgba(168,85,247,0.14)] flex items-center justify-center text-[#554C5C] mb-2.5">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <p className="text-xs font-mono font-semibold text-[#B8ADBF] mb-1">
                STANDBY // AWAITING OPERATIONAL DISPATCH
              </p>
              <p className="text-[10px] font-mono text-[#554C5C] max-w-sm">
                Execution feed will initialize upon mission verification. Real-time agent events and assertion logs will stream chronologically.
              </p>
            </motion.div>
          ) : (
            events.map((evt, idx) => {
              const isLatest = idx === events.length - 1;
              const isRecent = idx >= events.length - 3 && !isLatest;

              const agentStyle = AGENT_COLORS[evt.agentTag] || AGENT_COLORS.CORE;

              return (
                <motion.div
                  key={evt.id}
                  initial={
                    prefersReducedMotion
                      ? { opacity: 0 }
                      : { opacity: 0, y: 4 }
                  }
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    duration: 0.22,
                    ease: easings.technical,
                  }}
                  className={`p-2.5 rounded-lg border transition-all duration-200 ${
                    isLatest
                      ? 'bg-[#0D0917]/90 border-[rgba(192,132,252,0.4)] border-l-2 border-l-[#C084FC] shadow-[0_0_14px_rgba(168,85,247,0.12)]'
                      : isRecent
                      ? 'bg-[#07060B]/80 border-[rgba(168,85,247,0.10)] border-l-2 border-l-[rgba(168,85,247,0.3)]'
                      : 'bg-[#040306]/60 border-[rgba(168,85,247,0.05)] opacity-75'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-1 sm:gap-2 mb-1">
                    <div className="flex items-center gap-2">
                      {/* Active beacon for latest event */}
                      <span
                        className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                          isLatest
                            ? 'bg-[#C084FC] shadow-[0_0_6px_#C084FC] animate-ping'
                            : 'bg-[#554C5C]'
                        }`}
                      />
                      {/* Monospace Timestamp */}
                      <span className="text-[10px] font-mono text-[#554C5C] select-none">
                        {evt.timeString}
                      </span>
                      {/* Agent Tag */}
                      <span
                        className={`text-[9px] font-mono font-bold uppercase px-1.5 py-0.2 rounded border select-none ${agentStyle}`}
                      >
                        {evt.agentTag}
                      </span>
                      {/* Event Title */}
                      <span
                        className={`text-xs font-mono font-bold tracking-tight ${
                          isLatest
                            ? 'text-[#F5F1FA]'
                            : isRecent
                            ? 'text-[#E9D5FF]'
                            : 'text-[#B8ADBF]'
                        }`}
                      >
                        {evt.title}
                      </span>
                    </div>

                    {/* Status Pill */}
                    <span
                      className={`text-[9px] font-mono uppercase px-1.5 py-0.2 rounded self-end sm:self-auto ${
                        evt.status === 'completed'
                          ? 'bg-[rgba(57,255,136,0.1)] text-[#39FF88] border border-[rgba(57,255,136,0.25)] font-bold'
                          : isLatest
                          ? 'bg-[rgba(192,132,252,0.15)] text-[#C084FC] border border-[rgba(192,132,252,0.35)] font-bold'
                          : 'bg-[#090710] text-[#756B7D] border border-[rgba(168,85,247,0.06)]'
                      }`}
                    >
                      {evt.status === 'completed'
                        ? 'VERIFIED'
                        : isLatest
                        ? 'ACTIVE'
                        : 'LOGGED'}
                    </span>
                  </div>

                  {/* Operational Event Description */}
                  <p
                    className={`text-[11px] font-mono leading-relaxed pl-3.5 sm:pl-3.5 ${
                      isLatest
                        ? 'text-[#B8ADBF]'
                        : isRecent
                        ? 'text-[#756B7D]'
                        : 'text-[#554C5C]'
                    }`}
                  >
                    {evt.description}
                  </p>
                </motion.div>
              );
            })
          )}
        </AnimatePresence>
      </div>

      {/* Telemetry Stream Footer */}
      <div className="pt-2.5 mt-2 border-t border-[rgba(168,85,247,0.08)] flex flex-wrap items-center justify-between text-[9px] font-mono text-[#554C5C] gap-2 select-none">
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1">
            <span
              className={`h-1 w-1 rounded-full ${
                isSimulating ? 'bg-[#39FF88]' : 'bg-[#554C5C]'
              }`}
            />
            TRANSPORT: EVENT_STREAM
          </span>
          <span>•</span>
          <span>LATENCY: &lt;1ms (IN-MEM)</span>
        </div>
        <div className="text-[#756B7D]">
          SECURITY: DETERMINISTIC PIPELINE
        </div>
      </div>
    </GlassPanel>
  );
}
