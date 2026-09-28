import { useState, useEffect, useCallback } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import NexoraCore from './NexoraCore';
import { easings, durations } from '../motion/transitions';

const SYSTEM_SUBSYSTEMS = [
  { id: 'core', name: 'CORE ENGINE', readyText: 'ONLINE', targetProgress: 22 },
  { id: 'neural', name: 'NEURAL BUS', readyText: 'ONLINE', targetProgress: 44 },
  { id: 'agents', name: 'AGENT CLUSTER', readyText: '06/06 READY', targetProgress: 68 },
  { id: 'security', name: 'SECURITY ENCLAVE', readyText: 'AIR-GAPPED', targetProgress: 86 },
  { id: 'mission', name: 'MISSION ENGINE', readyText: 'READY', targetProgress: 100 },
];

/**
 * NexoraBootSequence
 * Cinematic, technical system initialization sequence.
 * Enforces restrained duration, robotic micro-details, and reduced-motion compliance.
 */
export default function NexoraBootSequence({ onComplete }) {
  const prefersReducedMotion = useReducedMotion();

  const [activeStep, setActiveStep] = useState(prefersReducedMotion ? 5 : 0);
  const [progress, setProgress] = useState(prefersReducedMotion ? 100 : 8);
  const [coreState, setCoreState] = useState(prefersReducedMotion ? 'executing' : 'idle');

  const handleFinish = useCallback(() => {
    if (onComplete) {
      onComplete();
    }
  }, [onComplete]);

  // Keyboard shortcut (Escape) to bypass sequence instantly
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        handleFinish();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleFinish]);

  // Timed sequential system initialization
  useEffect(() => {
    if (prefersReducedMotion) {
      const instantTimer = setTimeout(() => {
        handleFinish();
      }, 200);
      return () => clearTimeout(instantTimer);
    }

    const timers = [];

    // Phase 1: Core Engine initialized (400ms)
    timers.push(
      setTimeout(() => {
        setActiveStep(1);
        setProgress(28);
        setCoreState('idle');
      }, 420)
    );

    // Phase 2: Neural Bus connected (850ms)
    timers.push(
      setTimeout(() => {
        setActiveStep(2);
        setProgress(50);
        setCoreState('thinking');
      }, 860)
    );

    // Phase 3: Agent Cluster 06/06 ready (1300ms)
    timers.push(
      setTimeout(() => {
        setActiveStep(3);
        setProgress(72);
        setCoreState('thinking');
      }, 1320)
    );

    // Phase 4: Security Enclave air-gapped (1750ms)
    timers.push(
      setTimeout(() => {
        setActiveStep(4);
        setProgress(88);
        setCoreState('verifying');
      }, 1760)
    );

    // Phase 5: Mission Engine primed & all systems online (2150ms)
    timers.push(
      setTimeout(() => {
        setActiveStep(5);
        setProgress(100);
        setCoreState('executing');
      }, 2180)
    );

    // Phase 6: Core emphasis hold & handoff to dashboard (2650ms)
    timers.push(
      setTimeout(() => {
        handleFinish();
      }, 2680)
    );

    return () => {
      timers.forEach((t) => clearTimeout(t));
    };
  }, [prefersReducedMotion, handleFinish]);

  // Compute status headline from active step
  const getStatusText = () => {
    switch (activeStep) {
      case 0:
        return 'POWERING SYSTEM BUS';
      case 1:
        return 'CORE ENGINE NOMINAL';
      case 2:
        return 'NEURAL BUS SYNCHRONIZED';
      case 3:
        return 'CLUSTER ONLINE (06/06)';
      case 4:
        return 'SECURITY AIR-GAPPED';
      case 5:
        return 'NEXORA OPERATIONAL // ALL SYSTEMS ONLINE';
      default:
        return 'SYSTEM INITIALIZATION';
    }
  };

  return (
    <motion.div
      initial={{ opacity: 1 }}
      animate={{ opacity: 1 }}
      exit={{
        opacity: 0,
        y: -6,
        transition: {
          duration: durations.panel,
          ease: easings.smooth,
        },
      }}
      className="fixed inset-0 z-50 bg-[#010202] text-[#F5F1FA] flex flex-col justify-between p-4 sm:p-8 md:p-10 select-none overflow-hidden"
    >
      {/* ============================================================== */}
      {/* 1. ATMOSPHERIC TECHNICAL ENVIRONMENT                          */}
      {/* ============================================================== */}
      <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden">
        {/* Soft Violet Radial Bloom */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[720px] h-[520px] bg-gradient-to-b from-[#A855F7]/[0.08] via-[#6D28D9]/[0.03] to-transparent blur-[140px] rounded-full pointer-events-none" />

        {/* 72px Continuous Technical Grid (Exact match with workspace) */}
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `
              linear-gradient(to right, rgba(168, 85, 247, 0.085) 1px, transparent 1px),
              linear-gradient(to bottom, rgba(168, 85, 247, 0.085) 1px, transparent 1px)
            `,
            backgroundSize: '72px 72px',
            maskImage: 'radial-gradient(ellipse 90% 85% at 50% 50%, black 50%, rgba(0, 0, 0, 0.4) 85%, transparent 100%)',
            WebkitMaskImage: 'radial-gradient(ellipse 90% 85% at 50% 50%, black 50%, rgba(0, 0, 0, 0.4) 85%, transparent 100%)',
          }}
        />

        {/* Edge Vignette */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#010202]/50 via-transparent to-[#010202]/90 pointer-events-none" />
      </div>

      {/* ============================================================== */}
      {/* 2. TOP ROBOTIC TELEMETRY HEADER                                */}
      {/* ============================================================== */}
      <header className="relative z-10 w-full flex items-center justify-between text-[10px] font-mono">
        <div className="flex items-center gap-3">
          <span className="h-1.5 w-1.5 rounded-full bg-[#A855F7] shadow-[0_0_6px_#A855F7] animate-pulse" />
          <span className="tracking-widest uppercase text-[#C084FC] font-bold">
            NEXORA // BOOT PROTOCOL
          </span>
          <span className="text-[rgba(168,85,247,0.2)] select-none">/</span>
          <span className="text-[#554C5C] hidden xs:inline">SYS-INIT</span>
          <span className="text-[rgba(168,85,247,0.2)] select-none hidden xs:inline">/</span>
          <span className="text-[#756B7D] hidden sm:inline">CORE: 0x7E3F</span>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-[#554C5C] hidden md:inline">FREQ: 4.88 GHz</span>
          <span className="text-[rgba(168,85,247,0.2)] select-none hidden md:inline">•</span>
          <span className="text-[#756B7D] hidden sm:inline">ENCLAVE: SECURE</span>
          <button
            type="button"
            onClick={handleFinish}
            className="px-2.5 py-1 rounded bg-[#050508] border border-[rgba(168,85,247,0.18)] hover:border-[rgba(192,132,252,0.45)] text-[9px] text-[#756B7D] hover:text-[#E9D5FF] transition-colors cursor-pointer"
            aria-label="Skip initialization"
          >
            ESC // SKIP
          </button>
        </div>
      </header>

      {/* ============================================================== */}
      {/* 3. CENTRAL INITIALIZATION UNIT: CORE + TELEMETRY               */}
      {/* ============================================================== */}
      <main className="relative z-10 w-full max-w-xl mx-auto flex flex-col items-center justify-center my-auto py-2">
        {/* Existing NEXORA Core Component (Wake sequence) */}
        <motion.div
          animate={{
            scale: activeStep >= 5 ? 1.03 : 1,
            opacity: activeStep >= 1 ? 1 : 0.85,
          }}
          transition={{ duration: 0.45, ease: easings.technical }}
          className="relative mb-1"
        >
          <NexoraCore state={coreState} size="md" />

          {/* Micro Telemetry Pill Under Core */}
          <div className="absolute -bottom-1 left-1/2 -translate-x-1/2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#050508]/90 border border-[rgba(168,85,247,0.22)] text-[9px] font-mono tracking-wider text-[#C084FC]">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  activeStep >= 5
                    ? 'bg-[#39FF88] shadow-[0_0_6px_#39FF88]'
                    : 'bg-[#A855F7] shadow-[0_0_5px_#A855F7] animate-pulse'
                }`}
              />
              {activeStep >= 5 ? 'CORE OPERATIONAL' : 'CORE WAKING'}
            </span>
          </div>
        </motion.div>

        {/* System Title */}
        <div className="text-center mt-3 mb-2">
          <h1 className="text-2xl sm:text-3xl font-black font-mono tracking-wider text-[#F5F1FA]">
            NEXORA
          </h1>
          <p className="text-[10px] font-mono tracking-widest uppercase text-[#756B7D] mt-0.5">
            AUTONOMOUS AI WORKSPACE
          </p>
        </div>

        {/* Thin Technical Telemetry Progress Line (Task 4) */}
        <div className="w-full max-w-sm px-4 my-2">
          <div className="flex items-center justify-between text-[9px] font-mono text-[#554C5C] mb-1.5">
            <span className="tracking-wider">SYSTEM SCAN</span>
            <span className="text-[#C084FC] font-bold">{progress}%</span>
          </div>
          <div className="h-[2px] w-full bg-[#07060B] border border-[rgba(168,85,247,0.14)] rounded-full overflow-hidden relative">
            <motion.div
              className="h-full bg-gradient-to-r from-[#6D28D9] via-[#A855F7] to-[#C084FC] shadow-[0_0_8px_#A855F7]"
              style={{ width: `${progress}%` }}
              transition={{ ease: easings.technical, duration: 0.35 }}
            />
          </div>
        </div>

        {/* Telemetry Subsystems Stack Box */}
        <div className="w-full max-w-sm sm:max-w-md rounded-xl bg-[#050508]/92 border border-[rgba(168,85,247,0.12)] p-3.5 sm:p-4 shadow-[0_16px_40px_rgba(0,0,0,0.85)] relative mt-2">
          {/* Top subtle reflection line */}
          <div className="absolute inset-x-3 top-0 h-[1px] bg-gradient-to-r from-transparent via-[#A855F7]/20 to-transparent pointer-events-none" />

          {/* Tactical Corner Accents */}
          <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-[#A855F7]/30 rounded-tl-sm pointer-events-none" />
          <div className="absolute top-0 right-0 w-2 h-2 border-t border-r border-[#A855F7]/30 rounded-tr-sm pointer-events-none" />
          <div className="absolute bottom-0 left-0 w-2 h-2 border-b border-l border-[#A855F7]/30 rounded-bl-sm pointer-events-none" />
          <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-[#A855F7]/30 rounded-br-sm pointer-events-none" />

          {/* Subsystem State Headline */}
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-[rgba(168,85,247,0.08)] text-[9px] font-mono text-[#554C5C] uppercase tracking-wider">
            <span>SUBSYSTEM STATE</span>
            <span className={`font-semibold ${activeStep >= 5 ? 'text-[#39FF88]' : 'text-[#C084FC]'}`}>
              {getStatusText()}
            </span>
          </div>

          {/* 5 Subsystem Rows */}
          <div className="space-y-1.5 font-mono text-[11px] sm:text-xs">
            {SYSTEM_SUBSYSTEMS.map((sub, idx) => {
              const isDone = activeStep > idx;
              const isCurrent = activeStep === idx;
              return (
                <div
                  key={sub.id}
                  className="flex items-center justify-between gap-2 py-0.5 transition-colors"
                >
                  <span
                    className={`tracking-wider ${
                      isDone
                        ? 'text-[#B8ADBF]'
                        : isCurrent
                        ? 'text-[#F5F1FA] font-medium'
                        : 'text-[#554C5C]'
                    }`}
                  >
                    {sub.name}
                  </span>
                  <span className="text-[rgba(168,85,247,0.14)] select-none tracking-widest hidden xs:inline flex-1 text-center font-mono">
                    ..................
                  </span>
                  <span className="text-[10px] tracking-wider shrink-0 font-bold">
                    {isDone ? (
                      <span className="text-[#39FF88] flex items-center gap-1.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-[#39FF88] shadow-[0_0_4px_#39FF88]" />
                        {sub.readyText}
                      </span>
                    ) : isCurrent ? (
                      <span className="text-[#C084FC] flex items-center gap-1.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-[#A855F7] animate-pulse" />
                        INITIALIZING
                      </span>
                    ) : (
                      <span className="text-[#554C5C]">STANDBY</span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </main>

      {/* ============================================================== */}
      {/* 4. BOTTOM STATUS FOOTER                                        */}
      {/* ============================================================== */}
      <footer className="relative z-10 w-full flex flex-col sm:flex-row items-center justify-between text-[10px] font-mono text-[#554C5C] gap-2 pt-2 border-t border-[rgba(168,85,247,0.08)]">
        <div className="flex items-center gap-2">
          <span>PROTOCOL // QUANTUM RESISTANT</span>
          <span>•</span>
          <span className="text-[#756B7D]">CLUSTER ONLINE</span>
        </div>
        <div>
          <span>SECURE AI PROTOCOL // AUTONOMOUS OPERATING ENVIRONMENT</span>
        </div>
      </footer>
    </motion.div>
  );
}
