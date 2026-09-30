import { useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import TechnicalLabel from './TechnicalLabel';
import { MISSION_STATES } from '../constants/missionStates';
import { fadeIn } from '../motion/variants';
import { springs } from '../motion/transitions';

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
          /* ======================================================== */
          /* MISSION PACKET CONFIRMATION VIEW (Tasks 9, 10 & 11)      */
          /* ======================================================== */
          <motion.div
            key="mission-packet"
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
                  <span className="h-2 w-2 rounded-full bg-[#39FF88] shadow-[0_0_8px_#39FF88] animate-pulse" />
                  <span className="text-[10px] font-mono tracking-widest uppercase text-[#39FF88] font-bold">
                    MISSION PACKET // DISPATCH CONFIRMED
                  </span>
                </div>
                <TechnicalLabel variant="primary" size="xs">
                  ENCLAVE 01
                </TechnicalLabel>
              </div>

              {/* Dominant Success Title */}
              <h1 className="text-xl sm:text-2xl md:text-3xl font-mono font-bold tracking-tight text-[#F5F1FA] mb-2 leading-tight">
                MISSION ACCEPTED
              </h1>

              {/* Operational Subtitle */}
              <p className="text-xs sm:text-sm text-[#756B7D] leading-relaxed mb-4 max-w-xl">
                Autonomous cluster enqueued your directive packet. Neural bus linked to planner for task decomposition and agent dispatch.
              </p>

              {/* Structured Mission Packet Telemetry Table (Task 10) */}
              <div className="rounded-lg bg-[#050508] border border-[rgba(168,85,247,0.14)] p-3.5 mb-4 shadow-[0_8px_24px_rgba(0,0,0,0.6)]">
                <div className="flex items-center justify-between pb-2 mb-2 border-b border-[rgba(168,85,247,0.08)] text-[9px] font-mono text-[#554C5C] uppercase tracking-wider">
                  <span>PACKET METADATA</span>
                  <span className="text-[#39FF88] flex items-center gap-1">
                    <span className="h-1 w-1 rounded-full bg-[#39FF88]" />
                    VERIFIED // TLS 1.3
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <span className="text-[9px] font-mono uppercase tracking-wider text-[#554C5C] block mb-0.5">
                      Mission ID
                    </span>
                    <span className="text-xs font-mono font-bold text-[#E9D5FF] select-all truncate block">
                      {createdMission?.id || 'PENDING'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[9px] font-mono uppercase tracking-wider text-[#554C5C] block mb-0.5">
                      Status
                    </span>
                    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${
                      missionResult?.resultStatus?.ready && missionResult.resultStatus.verification === 'verified'
                        ? 'bg-[rgba(57,255,136,0.1)] border border-[rgba(57,255,136,0.25)] text-[#39FF88]'
                        : missionResult?.resultStatus?.ready && missionResult.resultStatus.verification === 'needs_revision'
                        ? 'bg-[rgba(245,158,11,0.1)] border border-[rgba(245,158,11,0.25)] text-[#F59E0B]'
                        : missionResult?.mission?.status === 'failed' || (missionResult?.resultStatus?.ready && missionResult.resultStatus.verification === 'failed')
                        ? 'bg-[rgba(239,68,68,0.1)] border border-[rgba(239,68,68,0.25)] text-[#EF4444]'
                        : 'bg-[rgba(192,132,252,0.1)] border border-[rgba(192,132,252,0.25)] text-[#C084FC]'
                    }`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${
                        missionResult?.resultStatus?.ready && missionResult.resultStatus.verification === 'verified'
                          ? 'bg-[#39FF88] shadow-[0_0_4px_#39FF88]'
                          : missionResult?.resultStatus?.ready && missionResult.resultStatus.verification === 'needs_revision'
                          ? 'bg-[#F59E0B]'
                          : missionResult?.mission?.status === 'failed' || (missionResult?.resultStatus?.ready && missionResult.resultStatus.verification === 'failed')
                          ? 'bg-[#EF4444]'
                          : 'bg-[#C084FC] animate-pulse'
                      }`} />
                      {missionResult?.resultStatus?.ready
                        ? missionResult.resultStatus.verification.toUpperCase()
                        : (missionResult?.mission?.status || createdMission?.status || 'QUEUED').toUpperCase()}
                    </span>
                  </div>
                  <div>
                    <span className="text-[9px] font-mono uppercase tracking-wider text-[#554C5C] block mb-0.5">
                      Dispatched At
                    </span>
                    <span className="text-xs font-mono text-[#B8ADBF] block">
                      {createdMission?.createdAt
                        ? new Date(createdMission.createdAt).toLocaleTimeString()
                        : 'JUST NOW'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Authoritative Backend Result Status & Telemetry (Step 8B.1) */}
              {resultLoading && !missionResult && (
                <div className="rounded-lg bg-[#07050E] border border-[rgba(168,85,247,0.2)] p-3 mb-4 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-[#C084FC] animate-pulse" />
                    <span className="text-[11px] font-mono text-[#E9D5FF]">
                      POLLING BACKEND RESULT // OPERATING PIPELINE
                    </span>
                  </div>
                  <span className="text-[9px] font-mono text-[#756B7D]">SYNC ACTIVE (2.5s)</span>
                </div>
              )}

              {resultError && (
                <div className="rounded-lg bg-[rgba(239,68,68,0.08)] border border-[rgba(239,68,68,0.3)] p-3 mb-4">
                  <div className="flex items-center gap-2 text-[#EF4444] text-xs font-mono font-bold mb-1">
                    <span>GATEWAY NOTICE:</span>
                    <span>{resultError}</span>
                  </div>
                  <p className="text-[10px] font-mono text-[#F87171]">
                    Authoritative result sync encountered an issue. Polling will resume automatically if transient.
                  </p>
                </div>
              )}

              {missionResult && (
                <div className="rounded-lg bg-[#050508] border border-[rgba(168,85,247,0.18)] p-3.5 mb-4 shadow-[0_4px_20px_rgba(0,0,0,0.5)]">
                  <div className="flex items-center justify-between pb-2 mb-2 border-b border-[rgba(168,85,247,0.1)] text-[9px] font-mono text-[#756B7D] uppercase tracking-wider">
                    <span>AUTHORITATIVE BACKEND RESULT</span>
                    <span className="text-[#39FF88] flex items-center gap-1">
                      <span className="h-1 w-1 rounded-full bg-[#39FF88]" />
                      {missionResult.resultStatus?.ready ? 'RESULT READY' : 'PIPELINE IN PROGRESS'}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-3">
                    <div className="p-2 rounded bg-[#090710] border border-[rgba(168,85,247,0.08)]">
                      <span className="text-[9px] font-mono text-[#756B7D] block">TASKS</span>
                      <span className="text-xs font-mono font-bold text-[#E9D5FF]">
                        {missionResult.tasks?.filter(t => t.status === 'completed').length || 0} / {missionResult.tasks?.length || 0}
                      </span>
                    </div>
                    <div className="p-2 rounded bg-[#090710] border border-[rgba(168,85,247,0.08)]">
                      <span className="text-[9px] font-mono text-[#756B7D] block">EVIDENCE</span>
                      <span className="text-xs font-mono font-bold text-[#38BDF8]">
                        {missionResult.evidence?.length || 0} verified
                      </span>
                    </div>
                    <div className="p-2 rounded bg-[#090710] border border-[rgba(168,85,247,0.08)]">
                      <span className="text-[9px] font-mono text-[#756B7D] block">ARTIFACT</span>
                      <span className="text-xs font-mono font-bold text-[#C084FC] truncate block">
                        {missionResult.artifact ? (missionResult.artifact.artifactType || 'Report').toUpperCase() : 'PENDING'}
                      </span>
                    </div>
                    <div className="p-2 rounded bg-[#090710] border border-[rgba(168,85,247,0.08)]">
                      <span className="text-[9px] font-mono text-[#756B7D] block">QA VERDICT</span>
                      <span className={`text-xs font-mono font-bold uppercase ${
                        missionResult.resultStatus?.qaVerdict === 'pass'
                          ? 'text-[#39FF88]'
                          : missionResult.resultStatus?.qaVerdict === 'needs_revision'
                          ? 'text-[#F59E0B]'
                          : missionResult.resultStatus?.qaVerdict === 'fail'
                          ? 'text-[#EF4444]'
                          : 'text-[#756B7D]'
                      }`}>
                        {missionResult.resultStatus?.qaVerdict || 'PENDING'}
                      </span>
                    </div>
                  </div>

                  {missionResult.artifact && (
                    <div className="pt-2 border-t border-[rgba(168,85,247,0.08)]">
                      <span className="text-[9px] font-mono text-[#756B7D] block mb-0.5 uppercase">
                        Synthesized Deliverable
                      </span>
                      <div className="text-xs font-mono text-[#F5F1FA] font-bold">
                        {missionResult.artifact.title}
                      </div>
                      {missionResult.artifact.executiveSummary && (
                        <p className="text-[11px] font-mono text-[#B8ADBF] mt-1 line-clamp-2 leading-relaxed">
                          {missionResult.artifact.executiveSummary}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Objective Display with CLI Prefix */}
              <div className="rounded-lg bg-[#050508] border border-[rgba(168,85,247,0.12)] p-3.5 mb-4">
                <div className="flex items-center justify-between mb-2 select-none">
                  <div className="flex items-center gap-2">
                    <span className="text-[#C084FC] font-mono text-xs font-bold">nx://objective &gt;</span>
                    <span className="text-[10px] font-mono text-[#554C5C]">ASSIGNED_DIRECTIVE</span>
                  </div>
                  <span className="text-[9px] font-mono text-[#554C5C]">
                    {createdMission?.objective?.length || missionDirective.length} CHARS
                  </span>
                </div>
                <p className="text-xs sm:text-sm font-mono text-[#F5F1FA] whitespace-pre-wrap leading-relaxed">
                  {createdMission?.objective || missionDirective}
                </p>
              </div>

              {/* Autonomous Execution Pathway (Task 11) */}
              <div className="p-3 rounded-lg bg-[#050508]/80 border border-[rgba(168,85,247,0.08)] mb-4">
                <div className="flex items-center justify-between text-[9px] font-mono text-[#554C5C] mb-2 uppercase tracking-wider">
                  <span>Autonomous Pipeline Handoff</span>
                  <span className="text-[#39FF88] font-bold">
                    {`STATE: ${currentConfig?.label || 'ACTIVE'}`}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 overflow-x-auto text-[10px] font-mono py-0.5 scrollbar-thin">
                  <span
                    className={`px-2 py-0.5 rounded border shrink-0 transition-colors ${
                      systemState === MISSION_STATES.IDLE
                        ? 'bg-[rgba(57,255,136,0.15)] text-[#39FF88] border-[rgba(57,255,136,0.3)] font-bold'
                        : 'bg-[#050508] text-[#756B7D] border-[rgba(168,85,247,0.08)]'
                    }`}
                  >
                    MISSION
                  </span>
                  <span className="text-[#554C5C] shrink-0">→</span>
                  <span
                    className={`px-2 py-0.5 rounded border shrink-0 transition-colors ${
                      systemState === MISSION_STATES.PLANNING
                        ? 'bg-[#090710] text-[#C084FC] border-[rgba(192,132,252,0.4)] shadow-[0_0_8px_rgba(168,85,247,0.2)] font-bold'
                        : 'bg-[#020203] text-[#756B7D] border-[rgba(168,85,247,0.08)]'
                    }`}
                  >
                    PLANNER
                  </span>
                  <span className="text-[#554C5C] shrink-0">→</span>
                  <span
                    className={`px-2 py-0.5 rounded border shrink-0 transition-colors ${
                      systemState === MISSION_STATES.PLANNING
                        ? 'bg-[#090710] text-[#E9D5FF] border-[rgba(192,132,252,0.3)] font-bold'
                        : 'bg-[#020203] text-[#756B7D] border-[rgba(168,85,247,0.08)]'
                    }`}
                  >
                    TASKS
                  </span>
                  <span className="text-[#554C5C] shrink-0">→</span>
                  <span
                    className={`px-2 py-0.5 rounded border shrink-0 transition-colors ${
                      systemState === MISSION_STATES.RESEARCHING || systemState === MISSION_STATES.ANALYZING
                        ? 'bg-[#090710] text-[#C084FC] border-[rgba(192,132,252,0.4)] shadow-[0_0_8px_rgba(168,85,247,0.2)] font-bold'
                        : 'bg-[#020203] text-[#756B7D] border-[rgba(168,85,247,0.08)]'
                    }`}
                  >
                    AGENTS
                  </span>
                  <span className="text-[#554C5C] shrink-0">→</span>
                  <span
                    className={`px-2 py-0.5 rounded border shrink-0 transition-colors ${
                      systemState === MISSION_STATES.ANALYZING
                        ? 'bg-[#090710] text-[#C084FC] border-[rgba(192,132,252,0.4)] font-bold'
                        : 'bg-[#020203] text-[#756B7D] border-[rgba(168,85,247,0.08)]'
                    }`}
                  >
                    EVIDENCE
                  </span>
                  <span className="text-[#554C5C] shrink-0">→</span>
                  <span
                    className={`px-2 py-0.5 rounded border shrink-0 transition-colors ${
                      systemState === MISSION_STATES.VERIFYING
                        ? 'bg-[#090710] text-[#C084FC] border-[rgba(192,132,252,0.4)] shadow-[0_0_8px_rgba(168,85,247,0.2)] font-bold'
                        : 'bg-[#020203] text-[#756B7D] border-[rgba(168,85,247,0.08)]'
                    }`}
                  >
                    CRITIC
                  </span>
                  <span className="text-[#554C5C] shrink-0">→</span>
                  <span
                    className={`px-2 py-0.5 rounded border shrink-0 transition-colors ${
                      systemState === MISSION_STATES.BUILDING
                        ? 'bg-[#090710] text-[#C084FC] border-[rgba(192,132,252,0.4)] shadow-[0_0_8px_rgba(168,85,247,0.2)] font-bold'
                        : 'bg-[#020203] text-[#756B7D] border-[rgba(168,85,247,0.08)]'
                    }`}
                  >
                    BUILDER
                  </span>
                  <span className="text-[#554C5C] shrink-0">→</span>
                  <span
                    className={`px-2 py-0.5 rounded border shrink-0 transition-colors ${
                      systemState === MISSION_STATES.QA
                        ? 'bg-[#090710] text-[#39FF88] border-[rgba(57,255,136,0.4)] shadow-[0_0_8px_rgba(57,255,136,0.2)] font-bold'
                        : 'bg-[#020203] text-[#756B7D] border-[rgba(168,85,247,0.08)]'
                    }`}
                  >
                    QA
                  </span>
                  <span className="text-[#554C5C] shrink-0">→</span>
                  <span
                    className={`px-2 py-0.5 rounded border shrink-0 transition-colors ${
                      systemState === MISSION_STATES.COMPLETE
                        ? 'bg-[rgba(57,255,136,0.15)] text-[#39FF88] border-[rgba(57,255,136,0.35)] shadow-[0_0_8px_rgba(57,255,136,0.25)] font-bold'
                        : 'bg-[#020203] text-[#756B7D] border-[rgba(168,85,247,0.08)]'
                    }`}
                  >
                    RESULT
                  </span>
                </div>
              </div>
            </div>

            {/* Console Success Footer */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pt-3 border-t border-[rgba(168,85,247,0.10)]">
              <div className="flex items-center gap-2 text-[10px] font-mono text-[#756B7D]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#39FF88]" />
                <span>MISSION PACKET LOCKED // DISPATCH PIPELINE ACTIVE</span>
              </div>

              <div className="flex items-center gap-3">
                <motion.button
                  type="button"
                  onClick={onReset}
                  whileHover={{ scale: 1.012 }}
                  whileTap={{ scale: 0.985 }}
                  transition={springs.tactile}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#090710] border border-[rgba(168,85,247,0.3)] px-4 py-2 text-xs font-mono font-bold text-[#E9D5FF] hover:bg-[#0E0D14] hover:border-[rgba(192,132,252,0.5)] hover:text-[#F5F1FA] transition-colors cursor-pointer"
                >
                  <span>+ CREATE ANOTHER MISSION</span>
                </motion.button>
              </div>
            </div>
          </motion.div>
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
