import { motion, useReducedMotion } from 'motion/react';
import NexoraCore from '../NexoraCore';
import TechnicalLabel from '../TechnicalLabel';
import { pageEnter } from '../../motion/variants';
import { Link } from '../../router/RouterContext';

/**
 * AuthLayout
 * Cinematic asymmetric composition for NEXORA authentication.
 * Desktop: Split view with system identity + restrained NexoraCore on left, elevated AuthPanel on right.
 * Mobile: Clean, responsive single-column stack with zero horizontal overflow.
 */
export default function AuthLayout({
  children,
  systemSubtitle = 'SYSTEM ACCESS // SECURE CHANNEL',
}) {
  const prefersReducedMotion = useReducedMotion();

  return (
    <div className="relative min-h-screen w-full bg-[#010202] text-[#F5F1FA] flex flex-col justify-between overflow-x-hidden selection:bg-[#A855F7]/30 selection:text-[#E9D5FF]">
      {/* ============================================================== */}
      {/* 1. ATMOSPHERIC TECHNICAL ENVIRONMENT & RADIAL LIGHTING          */}
      {/* ============================================================== */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        {/* Soft Violet Radial Illumination */}
        <div className="absolute top-[35%] left-1/2 -translate-x-1/2 -translate-y-1/2 w-[720px] h-[520px] bg-gradient-to-b from-[#A855F7]/[0.055] via-[#6D28D9]/[0.02] to-transparent blur-[160px] rounded-full pointer-events-none" />

        {/* Subtle Continuous Technical Grid */}
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `
              linear-gradient(to right, rgba(168, 85, 247, 0.075) 1px, transparent 1px),
              linear-gradient(to bottom, rgba(168, 85, 247, 0.075) 1px, transparent 1px)
            `,
            backgroundSize: '72px 72px',
            maskImage: 'radial-gradient(ellipse 90% 85% at 50% 35%, black 50%, rgba(0, 0, 0, 0.4) 85%, transparent 100%)',
            WebkitMaskImage: 'radial-gradient(ellipse 90% 85% at 50% 35%, black 50%, rgba(0, 0, 0, 0.4) 85%, transparent 100%)',
          }}
        />

        {/* Vignette Depth Layer */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#010202]/30 via-transparent to-[#010202]/90 pointer-events-none" />
      </div>

      {/* ============================================================== */}
      {/* 2. TOPBAR NAVIGATION STRIP                                     */}
      {/* ============================================================== */}
      <header className="relative z-10 w-full h-16 px-4 sm:px-8 border-b border-[rgba(168,85,247,0.10)] bg-[#020203]/80 backdrop-blur-md flex items-center justify-between">
        {/* Brand Link */}
        <Link to="/" className="flex items-center gap-3 group">
          <div className="h-8 w-8 rounded-lg bg-[#050508] border border-[rgba(168,85,247,0.16)] flex items-center justify-center relative transition-all duration-200 group-hover:border-[rgba(192,132,252,0.45)] group-hover:shadow-[0_0_12px_rgba(168,85,247,0.2)]">
            <span className="font-mono font-black text-sm text-[#C084FC]">N</span>
            <span className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-[#39FF88] shadow-[0_0_5px_#39FF88]" />
          </div>
          <div>
            <span className="font-bold tracking-widest text-sm text-[#F5F1FA] block font-mono group-hover:text-[#E9D5FF] transition-colors">
              NEXORA
            </span>
            <span className="text-[9.5px] tracking-wider text-[#756B7D] uppercase font-mono block">
              MISSION OS • AUTH GATEWAY
            </span>
          </div>
        </Link>

        {/* Return to Dashboard Action */}
        <div className="flex items-center gap-3">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-xs font-mono text-[#756B7D] hover:text-[#E9D5FF] px-3 py-1.5 rounded-lg bg-[#050508] border border-[rgba(168,85,247,0.10)] hover:border-[rgba(168,85,247,0.30)] transition-colors duration-200"
          >
            <span>←</span>
            <span className="hidden sm:inline">RETURN TO</span>
            <span>MISSION CONTROL</span>
          </Link>
        </div>
      </header>

      {/* ============================================================== */}
      {/* 3. MAIN CINEMATIC COMPOSITION                                  */}
      {/* ============================================================== */}
      <motion.main
        variants={prefersReducedMotion ? {} : pageEnter}
        initial="initial"
        animate="animate"
        exit="exit"
        className="relative z-10 flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12 flex flex-col justify-center"
      >
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center w-full my-auto">
          {/* ---------------------------------------------------------- */}
          {/* Left Column: NEXORA System Identity & Restrained Core      */}
          {/* ---------------------------------------------------------- */}
          <div className="lg:col-span-5 flex flex-col items-center lg:items-start text-center lg:text-left space-y-6">
            {/* Identity Header */}
            <div>
              <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-[#050508] border border-[rgba(168,85,247,0.14)] mb-3">
                <span className="h-1.5 w-1.5 rounded-full bg-[#39FF88] shadow-[0_0_6px_#39FF88]" />
                <span className="text-[10px] font-mono tracking-widest text-[#C084FC] uppercase">
                  {systemSubtitle}
                </span>
              </div>
              <h1 className="text-3xl sm:text-4xl font-mono font-black tracking-tight text-[#F5F1FA]">
                NEXORA
              </h1>
              <p className="text-xs sm:text-sm font-mono tracking-widest uppercase text-[#A855F7] mt-1 font-semibold">
                AUTONOMOUS AI WORKSPACE
              </p>
              <p className="text-xs sm:text-sm font-mono text-[#756B7D] leading-relaxed mt-3 max-w-md">
                Autonomous multi-agent orchestration console. Secure identity validation and air-gapped operator directives.
              </p>
            </div>

            {/* Restrained Core Visual presentation (Reusing existing NexoraCore) */}
            <div className="relative py-2 select-none pointer-events-none">
              <NexoraCore state="idle" size="sm" />
              {/* Subtle status tag below core */}
              <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 whitespace-nowrap">
                <TechnicalLabel variant="default" size="xs">
                  ENCLAVE 01 // ZERO-TRUST
                </TechnicalLabel>
              </div>
            </div>

            {/* Small Technical Telemetry Stamp */}
            <div className="w-full max-w-xs pt-4 border-t border-[rgba(168,85,247,0.10)] grid grid-cols-2 gap-2 text-[10px] font-mono text-[#554C5C]">
              <div>
                CORE: <span className="text-[#B8ADBF]">0x7E3F</span>
              </div>
              <div>
                BUS: <span className="text-[#39FF88]">AIR-GAPPED</span>
              </div>
              <div>
                NEURAL: <span className="text-[#B8ADBF]">STABLE</span>
              </div>
              <div>
                AUTH: <span className="text-[#C084FC]">ED25519</span>
              </div>
            </div>
          </div>

          {/* ---------------------------------------------------------- */}
          {/* Right Column: Authentication Panel Container               */}
          {/* ---------------------------------------------------------- */}
          <div className="lg:col-span-7 w-full max-w-lg mx-auto lg:max-w-none">
            {children}
          </div>
        </div>
      </motion.main>

      {/* ============================================================== */}
      {/* 4. FOOTER STATUS BAR                                           */}
      {/* ============================================================== */}
      <footer className="relative z-10 w-full py-4 px-4 sm:px-8 border-t border-[rgba(168,85,247,0.10)] flex flex-col sm:flex-row items-center justify-between text-[10px] font-mono text-[#554C5C] gap-2">
        <div className="flex items-center gap-3">
          <span>NEXORA MISSION OS</span>
          <span>•</span>
          <span className="text-[#C084FC]">SECURE OPERATOR ENCLAVE</span>
        </div>
        <div>
          <span>SECURE AI PROTOCOL // AUTONOMOUS OPERATING ENVIRONMENT</span>
        </div>
      </footer>
    </div>
  );
}
