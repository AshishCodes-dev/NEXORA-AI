import { useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import TechnicalLabel from './TechnicalLabel';
import { MISSION_STATES } from '../constants/missionStates';
import { fadeIn } from '../motion/variants';
import { springs } from '../motion/transitions';
import MissionResultView from './result/MissionResultView';

const DIRECTIVE_SUGGESTIONS = [
  {
    label: '+ Market Research',
    tag: 'INTEL',
    prompt: 'Conduct deep intelligence research on emerging autonomous AI frameworks, vector databases, and real-time agent orchestration architectures.',
  },
  {
    label: '+ Competitor Analysis',
    tag: 'ANALYST',
    prompt: 'Analyze competitive landscape for developer-focused autonomous AI platforms, comparing multi-agent capabilities, latency, and air-gapped security models.',
  },
  {
    label: '+ Architecture Strategy',
    tag: 'BUILDER',
    prompt: 'Architect a high-performance verification and testing harness for autonomous multi-agent pipelines with deterministic assertion logging.',
  },
  {
    label: '+ Document Audit',
    tag: 'SECURITY',
    prompt: 'Audit workspace security posture, evaluate air-gapped credential storage vectors, and synthesize vulnerability mitigation recommendations.',
  },
];

/**
 * MissionComposer
 * High-precision autonomous command center for directive input, validation,
 * suggestion loading, telemetry feedback, and mission packet confirmation.
 */
export default function MissionComposer({
  missionDirective,
  setMissionDirective,
  submissionState,
  submissionError,
  setSubmissionError,
  createdMission,
  systemState,
  currentConfig,
  missionResult = null,
  resultLoading = false,
  resultError = null,
  onSubmit,
  onReset,
}) {
  const textareaRef = useRef(null);
  const [isFocused, setIsFocused] = useState(false);
  const prefersReducedMotion = useReducedMotion();

  const handleSelectSuggestion = (prompt) => {
    setMissionDirective(prompt);
    if (setSubmissionError) setSubmissionError(null);
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  };

  const handleKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      if (submissionState === 'processing') return;
      if (onSubmit) onSubmit(e);
    }
  };

  const charCount = missionDirective.length;
  const wordCount = missionDirective.trim() ? missionDirective.trim().split(/\s+/).length : 0;

  return (
    <div
      className={`lg:col-span-7 flex flex-col justify-between p-6 sm:p-8 rounded-xl bg-[#07060B]/90 border border-[rgba(168,85,247,0.12)] shadow-[0_16px_48px_rgba(0,0,0,0.85)] relative transition-all duration-300 ${
        submissionState === 'success' ? 'border-l-2 border-l-[#39FF88]' : 'border-l-2 border-l-[#A855F7]'
      }`}
    >
      <AnimatePresence mode="wait">
        {submissionState === 'success' && createdMission ? (
          <MissionResultView
            missionResult={missionResult}
            resultLoading={resultLoading}
            resultError={resultError}
            createdMission={createdMission}
            onReset={onReset}
          />
        ) : (
          /* ======================================================== */
          /* COMMAND CONSOLE VIEW (Tasks 2, 3, 4, 5, 6, 7 & 8)         */
          /* ======================================================== */
          <motion.div
            key="mission-composer"
            variants={fadeIn}
            initial="initial"
            animate="animate"
            exit="exit"
            className="flex-1 flex flex-col justify-between"
          >
            <div>
              {/* Console Top Header */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#A855F7] shadow-[0_0_5px_#A855F7] animate-pulse" />
                  <span className="text-[10px] font-mono tracking-widest uppercase text-[#C084FC] font-semibold">
                    DIRECTIVE CHANNEL // COMMAND CONSOLE
                  </span>
                </div>
                <TechnicalLabel variant="default" size="xs">
                  INPUT MODE: AUTONOMOUS
                </TechnicalLabel>
              </div>

              {/* Dominant Focal Title */}
              <h1 className="text-xl sm:text-2xl md:text-3xl font-mono font-bold tracking-tight text-[#F5F1FA] mb-2 leading-tight">
                WHAT SHOULD NEXORA ACCOMPLISH?
              </h1>

              {/* Operational Subtitle */}
              <p className="text-xs sm:text-sm text-[#756B7D] leading-relaxed mb-4 max-w-xl">
                Assign an operational directive to the autonomous cluster. System agents coordinate research, synthesize evidence, and execute verified workflows.
              </p>

              {/* Mission Example Suggestion Chips (Task 5) */}
              <div className="mb-3.5">
                <div className="flex items-center justify-between mb-1.5 text-[9px] font-mono text-[#554C5C] uppercase tracking-wider">
                  <span>Directive Suggestions</span>
                  <span className="text-[#756B7D]">Click to populate</span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {DIRECTIVE_SUGGESTIONS.map((suggestion) => (
                    <motion.button
                      key={suggestion.label}
                      type="button"
                      whileHover={prefersReducedMotion ? {} : { scale: 1.02 }}
                      whileTap={prefersReducedMotion ? {} : { scale: 0.98 }}
                      transition={springs.subtle}
                      onClick={() => handleSelectSuggestion(suggestion.prompt)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#050508] border border-[rgba(168,85,247,0.12)] hover:border-[rgba(192,132,252,0.4)] text-[10px] font-mono text-[#B8ADBF] hover:text-[#F5F1FA] transition-colors cursor-pointer"
                    >
                      <span className="text-[#C084FC] font-bold">{suggestion.label}</span>
                      <span className="text-[8px] text-[#554C5C] px-1 py-0.2 rounded bg-[#090710] border border-[rgba(168,85,247,0.06)]">
                        {suggestion.tag}
                      </span>
                    </motion.button>
                  ))}
                </div>
              </div>

              {/* Tactical Command Input Box (Tasks 3, 4, 6 & 7) */}
              <div
                className={`relative rounded-lg bg-[#050508] border transition-all duration-200 p-3 sm:p-4 mb-3 ${
                  isFocused
                    ? 'border-[rgba(192,132,252,0.50)] shadow-[0_0_24px_rgba(168,85,247,0.14)]'
                    : 'border-[rgba(168,85,247,0.14)]'
                }`}
              >
                {/* Header within console box */}
                <div className="flex items-center justify-between mb-2 select-none">
                  <div className="flex items-center gap-2">
                    <span className="text-[#C084FC] font-mono text-xs font-bold">nx://directive &gt;</span>
                    <span className="text-[10px] font-mono text-[#554C5C]">COMMAND_CHANNEL</span>
                  </div>
                  <span className="text-[9px] font-mono text-[#554C5C]">
                    Ctrl+Enter / ⌘+Enter to dispatch
                  </span>
                </div>

                {/* Multiline Controlled Textarea */}
                <textarea
                  ref={textareaRef}
                  rows="3"
                  value={missionDirective}
                  onFocus={() => setIsFocused(true)}
                  onBlur={() => setIsFocused(false)}
                  onChange={(e) => {
                    setMissionDirective(e.target.value);
                    if (submissionError && setSubmissionError) setSubmissionError(null);
                  }}
                  onKeyDown={handleKeyDown}
                  disabled={submissionState === 'processing'}
                  placeholder="Describe what you want NEXORA to accomplish (e.g. Audit autonomous workspace security vectors, synthesize agent telemetry, and scaffold verification tests)..."
                  className="w-full bg-transparent text-sm font-mono text-[#F5F1FA] placeholder-[#554C5C] focus:outline-none resize-none leading-relaxed disabled:opacity-50"
                />

                {/* Input Telemetry Metadata Strip (Task 7) */}
                <div className="pt-2.5 mt-1 border-t border-[rgba(168,85,247,0.08)] flex flex-wrap items-center justify-between text-[9px] font-mono text-[#554C5C] gap-2 select-none">
                  <div className="flex items-center gap-3">
                    <span>
                      DIRECTIVE LENGTH: <strong className="text-[#B8ADBF]">{charCount} CHARS</strong>
                    </span>
                    <span>•</span>
                    <span>
                      WORDS: <strong className="text-[#B8ADBF]">{wordCount}</strong>
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span>INPUT MODE: <span className="text-[#B8ADBF]">MULTILINE</span></span>
                    <span>•</span>
                    <span className="text-[#39FF88]">CHANNEL: SECURE</span>
                  </div>
                </div>
              </div>

              {/* Inline Technical Error Notice (Task 12) */}
              {submissionError && (
                <motion.div
                  initial={prefersReducedMotion ? {} : { opacity: 0, y: -4 }}
                  animate={prefersReducedMotion ? {} : { opacity: 1, y: 0 }}
                  className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg bg-[rgba(239,68,68,0.08)] border border-[rgba(239,68,68,0.25)] text-xs font-mono text-[#FCA5A5] mb-3"
                >
                  <span className="h-2 w-2 rounded-full bg-[#EF4444] animate-ping shrink-0" />
                  <span className="font-semibold text-[#F87171] shrink-0">ERROR // DISPATCH_FAILED:</span>
                  <span>{submissionError}</span>
                </motion.div>
              )}
            </div>

            {/* Console Execution Footer (Task 8) */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pt-3 border-t border-[rgba(168,85,247,0.10)]">
              {/* Status & Readiness Metadata */}
              <div className="flex flex-wrap items-center gap-3 text-[10px] font-mono text-[#756B7D]">
                <span className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#39FF88]" />
                  CLUSTER READY
                </span>
                <span>•</span>
                <span>SECURITY: AIR-GAPPED</span>
                <span>•</span>
                <span>VERIFICATION: STRICT</span>
              </div>

              {/* Command Execution Button */}
              <motion.button
                type="button"
                onClick={onSubmit}
                disabled={submissionState === 'processing'}
                whileHover={submissionState === 'processing' || prefersReducedMotion ? {} : { scale: 1.012 }}
                whileTap={submissionState === 'processing' || prefersReducedMotion ? {} : { scale: 0.985 }}
                transition={springs.tactile}
                className={`group relative inline-flex items-center justify-center gap-2.5 overflow-hidden rounded-lg px-6 py-2.5 text-xs sm:text-sm font-bold font-mono tracking-wider transition-colors duration-200 cursor-pointer min-h-[42px] ${
                  submissionState === 'processing'
                    ? 'bg-[#090710] border border-[rgba(168,85,247,0.3)] text-[#C084FC] cursor-not-allowed opacity-80'
                    : submissionState === 'error'
                    ? 'bg-[#180A0E] border border-[rgba(239,68,68,0.45)] text-[#FCA5A5] hover:border-[rgba(239,68,68,0.7)] shadow-[0_0_15px_rgba(239,68,68,0.15)]'
                    : 'bg-[#090710] border border-[rgba(168,85,247,0.45)] border-t-[rgba(233,213,255,0.30)] text-[#E9D5FF] shadow-[0_0_15px_rgba(168,85,247,0.18)] hover:bg-[#0E0D14] hover:border-[rgba(192,132,252,0.60)] hover:text-[#F5F1FA] hover:shadow-[0_0_22px_rgba(168,85,247,0.28)]'
                }`}
              >
                {submissionState === 'processing' && (
                  <>
                    <svg className="animate-spin w-4 h-4 text-[#C084FC]" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span>DISPATCHING...</span>
                  </>
                )}

                {submissionState === 'error' && (
                  <>
                    <svg className="w-4 h-4 text-[#FCA5A5]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                    </svg>
                    <span>RETRY DISPATCH</span>
                  </>
                )}

                {submissionState === 'idle' && (
                  <>
                    <svg
                      className="w-4 h-4 text-[#C084FC] transition-transform duration-300 group-hover:translate-x-0.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
                    </svg>
                    <span>RUN MISSION →</span>
                  </>
                )}
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
