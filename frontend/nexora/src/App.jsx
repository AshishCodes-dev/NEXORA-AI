import { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import Topbar from './components/Topbar';
import NexoraCore from './components/NexoraCore';
import TechnicalLabel from './components/TechnicalLabel';
import GlassPanel from './components/GlassPanel';
import StatusIndicator from './components/StatusIndicator';

export default function App() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [coreState, setCoreState] = useState('executing');

  // Preserve working frontend-backend health check functionality
  const [backendHealth, setBackendHealth] = useState(null);
  const [backendLoading, setBackendLoading] = useState(true);
  const [backendConnected, setBackendConnected] = useState(false);

  useEffect(() => {
    const checkBackend = async () => {
      try {
        setBackendLoading(true);
        const response = await fetch('http://localhost:5000/api/health');
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();
        setBackendHealth(data);
        setBackendConnected(true);
        setCoreState('executing');
      } catch (err) {
        setBackendHealth({ status: 'offline', message: err.message });
        setBackendConnected(false);
        setCoreState('idle');
      } finally {
        setBackendLoading(false);
      }
    };

    checkBackend();
  }, []);

  // Technical HUD Metrics: Black + Violet + White Hierarchy
  const hudMetrics = [
    {
      label: 'SYSTEM STATUS',
      value: backendConnected ? 'ONLINE' : 'STANDBY',
      subtext: backendConnected ? 'PORT 5000 ACTIVE' : 'LOCAL CORE READY',
      valueColor: 'text-[#F5F1FA]',
      dotColor: backendConnected ? 'bg-[#39FF88]' : 'bg-[#A855F7]',
      isSuccess: backendConnected,
    },
    {
      label: 'ACTIVE AGENTS',
      value: '03',
      subtext: 'AUTONOMOUS POOL',
      valueColor: 'text-[#C084FC]',
      dotColor: 'bg-[#A855F7]',
    },
    {
      label: 'MISSION STATE',
      value: 'READY',
      subtext: 'AWAITING DIRECTIVE',
      valueColor: 'text-[#E9D5FF]',
      dotColor: 'bg-[#C084FC]',
    },
    {
      label: 'TASK QUEUE',
      value: '00',
      subtext: 'PIPELINE CLEAR',
      valueColor: 'text-[#C084FC]',
      dotColor: 'bg-[#A855F7]',
    },
    {
      label: 'EVIDENCE COUNT',
      value: '00',
      subtext: 'NEURAL MEMORY SYNCED',
      valueColor: 'text-[#E9D5FF]',
      dotColor: 'bg-[#6D28D9]',
    },
  ];

  return (
    <div className="relative min-h-screen w-full bg-[#010202] text-[#F5F1FA] flex overflow-x-hidden selection:bg-[#A855F7]/30 selection:text-[#E9D5FF]">
      {/* ============================================================== */}
      {/* LAYER 1: ABSOLUTE VOID & SINGLE CORE ATMOSPHERIC VIOLET SOURCE */}
      {/* ============================================================== */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        {/* The NEXORA Core Atmospheric Bloom: Soft Violet Fading into Black */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[500px] bg-gradient-to-b from-[#A855F7]/[0.055] via-[#6D28D9]/[0.02] to-transparent blur-[160px] rounded-full" />

        {/* Extremely Subtle Technical Violet Grid with Tight Radial Mask */}
        <div
          className="absolute inset-0 opacity-[0.022]"
          style={{
            backgroundImage: `radial-gradient(circle at 1px 1px, #A855F7 1px, transparent 0)`,
            backgroundSize: '32px 32px',
            maskImage: 'radial-gradient(ellipse 60% 60% at 50% 50%, black 20%, transparent 85%)',
            WebkitMaskImage: 'radial-gradient(ellipse 60% 60% at 50% 50%, black 20%, transparent 85%)',
          }}
        />

        {/* Deep Black Void Vignette */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#010202]/60 via-transparent to-[#010202]/95" />
      </div>

      {/* ============================================================== */}
      {/* LAYER 2: MIDDLE GROUND (SIDEBAR & WORKSPACE STRUCTURE)          */}
      {/* ============================================================== */}
      <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />

      <div className="flex-1 flex flex-col min-w-0 min-h-screen relative z-10">
        {/* Topbar with Real-time System Telemetry */}
        <Topbar
          onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
          backendConnected={backendConnected}
        />

        {/* ============================================================ */}
        {/* LAYER 3: FOREGROUND (CORE, TELEMETRY & PRIMARY ACTION)       */}
        {/* ============================================================ */}
        <main className="flex-1 p-4 sm:p-8 lg:p-10 flex flex-col items-center justify-between max-w-7xl w-full mx-auto">
          {/* Top Status Header */}
          <div className="w-full flex items-center justify-between mb-4 sm:mb-6">
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-[#A855F7] shadow-[0_0_8px_#A855F7]" />
              <span className="text-[10px] sm:text-[11px] font-mono tracking-widest text-[#756B7D] uppercase">
                WORKSPACE MATRIX // RUNTIME v0.1
              </span>
            </div>

            {/* AI Core State Indicator */}
            <div className="flex items-center gap-2">
              <span className="hidden sm:inline text-[10px] font-mono text-[#554C5C]">
                AI CORE STATE:
              </span>
              <StatusIndicator state={coreState} />
            </div>
          </div>

          {/* Central Core & Brand Experience */}
          <div className="my-auto flex flex-col items-center text-center py-6">
            {/* NEXORA Core Visual Centerpiece */}
            <div className="mb-6 relative">
              <NexoraCore state={coreState} size="lg" />

              {/* Status Ribbon below Core */}
              <div className="absolute -bottom-2 left-1/2 -translate-x-1/2">
                <TechnicalLabel variant={backendConnected ? 'primary' : 'default'} size="sm">
                  {backendConnected ? 'CORE ONLINE // LINKED' : 'CORE STANDBY // LOCAL'}
                </TechnicalLabel>
              </div>
            </div>

            {/* Brand Title: Very Bright Almost-White Heading */}
            <h1 className="text-4xl sm:text-6xl md:text-7xl font-black tracking-tight text-[#F5F1FA] mb-2 font-mono">
              NEXORA
            </h1>

            {/* Subtitle: Muted Violet-Gray Text */}
            <p className="text-xs sm:text-sm text-[#756B7D] tracking-wider uppercase font-mono max-w-md mb-8">
              Autonomous AI Workspace
            </p>

            {/* Technical HUD Telemetry Placeholders Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 w-full max-w-4xl mb-10 text-left">
              {hudMetrics.map((metric) => (
                <GlassPanel key={metric.label} className="p-3 sm:p-3.5">
                  <div className="text-[9px] font-mono tracking-wider text-[#554C5C] uppercase mb-1.5 flex items-center justify-between">
                    <span>{metric.label}</span>
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${metric.dotColor} ${
                        metric.isSuccess ? 'shadow-[0_0_5px_#39FF88]' : 'shadow-[0_0_5px_#A855F7]'
                      }`}
                    />
                  </div>
                  <div className={`text-base sm:text-lg font-mono font-bold tracking-tight ${metric.valueColor}`}>
                    {metric.value}
                  </div>
                  <div className="text-[10px] font-mono text-[#756B7D] tracking-tight mt-0.5 truncate">
                    {metric.subtext}
                  </div>
                </GlassPanel>
              ))}
            </div>

            {/* Empty State / Engineered Primary Action Surface */}
            <GlassPanel elevated glow className="w-full max-w-lg p-6 sm:p-8 text-center flex flex-col items-center">
              <div className="mb-4 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#A855F7]/[0.08] border border-[rgba(168,85,247,0.22)] text-[10px] font-mono text-[#C084FC]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#A855F7] shadow-[0_0_5px_#A855F7] animate-pulse" />
                <span>MISSION PROTOCOL READY</span>
              </div>

              {/* Mission Title: White */}
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-[#F5F1FA] mb-2 font-mono">
                Ready for your next mission
              </h2>

              <p className="text-xs sm:text-sm text-[#756B7D] max-w-sm mb-6 leading-relaxed">
                Initialize autonomous execution to deploy agent teams, coordinate deep research, and stream verified artifacts.
              </p>

              {/* Primary NEXORA Button: Dark Violet Base + Electric Violet Border + Subtle Bloom */}
              <button
                type="button"
                className="group relative inline-flex items-center justify-center gap-2.5 overflow-hidden rounded-lg bg-[#090710] border border-[rgba(168,85,247,0.45)] border-t-[rgba(233,213,255,0.30)] px-7 py-3 text-xs sm:text-sm font-bold font-mono tracking-wider text-[#E9D5FF] shadow-[0_0_15px_rgba(168,85,247,0.18)] transition-all duration-300 hover:bg-[#0E0D14] hover:border-[rgba(192,132,252,0.60)] hover:text-[#F5F1FA] hover:shadow-[0_0_22px_rgba(168,85,247,0.28)] active:scale-[0.98] cursor-pointer"
              >
                <svg
                  className="w-4 h-4 text-[#C084FC] transition-transform duration-300 group-hover:rotate-90 group-hover:text-[#F5F1FA]"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                <span>CREATE MISSION</span>
              </button>

              <span className="text-[9px] font-mono text-[#554C5C] mt-3 tracking-wide">
                SYS_CMD: INITIALIZE_AUTONOMOUS_PIPELINE
              </span>
            </GlassPanel>

            {/* Interactive AI State Preview Pill Bar */}
            <div className="mt-8 flex flex-wrap items-center justify-center gap-1.5 sm:gap-2">
              <span className="text-[9px] font-mono text-[#554C5C] uppercase mr-1">
                STATE PREVIEW:
              </span>
              {[
                { id: 'idle', color: 'border-[rgba(168,85,247,0.16)] text-[#B8ADBF]' },
                { id: 'thinking', color: 'border-[rgba(192,132,252,0.30)] text-[#E9D5FF]' },
                { id: 'executing', color: 'border-[rgba(168,85,247,0.45)] text-[#C084FC]' },
                { id: 'verifying', color: 'border-[rgba(233,213,255,0.30)] text-[#E9D5FF]' },
                { id: 'warning', color: 'border-[#FFB84D]/30 text-[#FFB84D]' },
                { id: 'error', color: 'border-[#FF5577]/30 text-[#FF5577]' },
              ].map(({ id, color }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setCoreState(id)}
                  className={`text-[9px] font-mono uppercase px-2 py-0.5 rounded border transition-all cursor-pointer ${
                    coreState === id
                      ? `${color} bg-[#090710] shadow-[0_0_8px_rgba(168,85,247,0.15)]`
                      : 'border-[rgba(168,85,247,0.08)] text-[#756B7D] hover:text-[#B8ADBF] hover:border-[rgba(168,85,247,0.16)] bg-[#050508]'
                  }`}
                >
                  {id}
                </button>
              ))}
            </div>
          </div>

          {/* Bottom Telemetry Status Strip */}
          <footer className="w-full pt-4 border-t border-[rgba(168,85,247,0.10)] flex flex-col sm:flex-row items-center justify-between text-[10px] font-mono text-[#554C5C] gap-2">
            <div className="flex items-center gap-3">
              <span>NEXORA MISSION OS</span>
              <span>•</span>
              <span className="text-[#C084FC]">
                {backendHealth?.message ? `BACKEND: ${backendHealth.message}` : 'STANDBY TELEMETRY'}
              </span>
            </div>
            <div>
              <span>SECURE AI PROTOCOL // AUTONOMOUS OPERATING ENVIRONMENT</span>
            </div>
          </footer>
        </main>
      </div>
    </div>
  );
}
