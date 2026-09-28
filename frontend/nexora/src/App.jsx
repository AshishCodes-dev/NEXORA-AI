import { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import Topbar from './components/Topbar';
import NexoraCore from './components/NexoraCore';
import TechnicalLabel from './components/TechnicalLabel';
import GlassPanel from './components/GlassPanel';

export default function App() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [coreState, setCoreState] = useState('executing');
  const [missionDirective, setMissionDirective] = useState('');

  // Mission Submission & Lifecycle State
  const [submissionState, setSubmissionState] = useState('idle'); // 'idle' | 'processing' | 'success' | 'error'
  const [submissionError, setSubmissionError] = useState(null);
  const [createdMission, setCreatedMission] = useState(null);

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

  // Submit Mission to Backend API (POST /api/missions)
  const handleRunMission = async (e) => {
    if (e) e.preventDefault();

    // Prevent duplicate submission while already processing
    if (submissionState === 'processing') return;

    const trimmed = missionDirective.trim();

    // Validation: reject empty or whitespace-only directive
    if (!trimmed) {
      setSubmissionError('Mission objective cannot be empty. Please specify an operational directive.');
      setSubmissionState('error');
      return;
    }

    setSubmissionState('processing');
    setSubmissionError(null);
    setCoreState('thinking');

    try {
      const response = await fetch('http://localhost:5000/api/missions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ objective: trimmed }),
      });

      let data;
      try {
        data = await response.json();
      } catch {
        throw new Error(`Server returned unexpected non-JSON response (HTTP ${response.status})`);
      }

      if (!response.ok || !data || !data.success || !data.mission || typeof data.mission !== 'object' || !data.mission.id) {
        throw new Error(data?.error || `Server responded with status ${response.status}`);
      }

      setCreatedMission(data.mission);
      setSubmissionState('success');
      setCoreState('executing');
    } catch (err) {
      const errorMessage =
        err.message === 'Failed to fetch' || err.name === 'TypeError'
          ? 'NEXORA backend unavailable on port 5000. Ensure server is running.'
          : err.message || 'Mission initialization failed. Please retry.';
      setSubmissionError(errorMessage);
      setSubmissionState('error');
      setCoreState('idle');
    }
  };

  // Reset Composer for New Mission
  const handleResetMission = () => {
    setSubmissionState('idle');
    setMissionDirective('');
    setCreatedMission(null);
    setSubmissionError(null);
  };

  // System Telemetry Metrics
  const systemTelemetry = [
    {
      label: 'MISSION ENGINE',
      value: createdMission ? 'ACTIVE' : 'AUTONOMOUS',
      tag: createdMission ? 'ENCLAVE 01' : 'V4.2',
      color: 'text-[#E9D5FF]',
      dot: 'bg-[#A855F7]',
    },
    {
      label: 'AGENTS READY',
      value: '06 / 06',
      tag: 'CLUSTER ONLINE',
      color: 'text-[#C084FC]',
      dot: 'bg-[#C084FC]',
    },
    {
      label: 'SYSTEM STATUS',
      value: backendConnected ? 'ONLINE' : 'STANDBY',
      tag: backendConnected ? 'PORT 5000' : 'LOCAL CORE',
      color: 'text-[#F5F1FA]',
      dot: backendConnected ? 'bg-[#39FF88]' : 'bg-[#A855F7]',
      isSuccess: backendConnected,
    },
    {
      label: 'PROCESSING',
      value: createdMission ? 'QUEUED' : 'STANDBY',
      tag: createdMission?.id ? `ID: ${createdMission.id.slice(0, 10)}` : 'QUEUE 0',
      color: createdMission ? 'text-[#39FF88]' : 'text-[#B8ADBF]',
      dot: createdMission ? 'bg-[#39FF88]' : 'bg-[#6D28D9]',
      isSuccess: !!createdMission,
    },
  ];

  // Connected Autonomous System Modules (6 Agents)
  const agentModules = [
    {
      id: 'MOD.01',
      name: 'Research Agent',
      role: 'Deep intelligence & semantic retrieval',
      status: 'ONLINE',
      state: 'ready',
      activity: 'Knowledge graph indexed',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
        </svg>
      ),
    },
    {
      id: 'MOD.02',
      name: 'Browser Agent',
      role: 'Automated DOM exploration & web telemetry',
      status: 'READY',
      state: 'ready',
      activity: 'Headless runtime ready',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-.778.099-1.533.284-2.253" />
        </svg>
      ),
    },
    {
      id: 'MOD.03',
      name: 'Analyst Agent',
      role: 'Context compaction & inductive reasoning',
      status: 'STANDBY',
      state: 'idle',
      activity: 'Neural buffer clear',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5m.75-9l3-3 2.25 2.25L15 6" />
        </svg>
      ),
    },
    {
      id: 'MOD.04',
      name: 'Critic Agent',
      role: 'Verification & logic auditing engine',
      status: 'STANDBY',
      state: 'idle',
      activity: 'Consistency rules loaded',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
        </svg>
      ),
    },
    {
      id: 'MOD.05',
      name: 'Builder Agent',
      role: 'Code generation & artifact architecture',
      status: 'READY',
      state: 'ready',
      activity: 'Workspace sandbox primed',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
          <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
        </svg>
      ),
    },
    {
      id: 'MOD.06',
      name: 'QA Agent',
      role: 'Automated test validation & assertions',
      status: 'STANDBY',
      state: 'idle',
      activity: 'Harness standby',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6a7.5 7.5 0 107.5 7.5h-7.5V6z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 10.5H21A7.5 7.5 0 0013.5 3v7.5z" />
        </svg>
      ),
    },
  ];

  return (
    <div className="relative min-h-screen w-full bg-[#010202] text-[#F5F1FA] flex overflow-x-hidden selection:bg-[#A855F7]/30 selection:text-[#E9D5FF]">
      {/* ============================================================== */}
      {/* 1. TECHNICAL GRID ENVIRONMENT & ATMOSPHERIC LIGHTING           */}
      {/* ============================================================== */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        {/* Ambient Radial Illumination (Soft focal glow matching inspiration) */}
        <div className="absolute top-[28%] left-1/2 -translate-x-1/2 -translate-y-1/2 w-[840px] h-[580px] bg-gradient-to-b from-[#A855F7]/[0.065] via-[#6D28D9]/[0.025] to-transparent blur-[160px] rounded-full pointer-events-none" />

        {/* Subtle Technical Grid Background (Continuous, crisp 1px lines inspired by reference image) */}
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `
              linear-gradient(to right, rgba(168, 85, 247, 0.085) 1px, transparent 1px),
              linear-gradient(to bottom, rgba(168, 85, 247, 0.085) 1px, transparent 1px)
            `,
            backgroundSize: '72px 72px',
            maskImage: 'radial-gradient(ellipse 92% 88% at 50% 28%, black 55%, rgba(0, 0, 0, 0.45) 85%, transparent 100%)',
            WebkitMaskImage: 'radial-gradient(ellipse 92% 88% at 50% 28%, black 55%, rgba(0, 0, 0, 0.45) 85%, transparent 100%)',
          }}
        />

        {/* Cinematic Vignette for Edge Depth */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#010202]/30 via-transparent to-[#010202]/85 pointer-events-none" />
      </div>

      {/* ============================================================== */}
      {/* NAVIGATION: SIDEBAR SHELL                                      */}
      {/* ============================================================== */}
      <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />

      {/* ============================================================== */}
      {/* MAIN COMMAND CENTER WORKSPACE                                   */}
      {/* ============================================================== */}
      <div className="flex-1 flex flex-col min-w-0 min-h-screen relative z-10">
        {/* Topbar with Real-time System Telemetry */}
        <Topbar
          onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
          backendConnected={backendConnected}
        />

        <main className="flex-1 p-4 sm:p-6 lg:p-8 flex flex-col gap-6 max-w-7xl w-full mx-auto">
          {/* ============================================================ */}
          {/* 4. SYSTEM TELEMETRY HUD STRIP                               */}
          {/* ============================================================ */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 w-full">
            {systemTelemetry.map((metric) => (
              <GlassPanel key={metric.label} className="p-3 sm:p-3.5">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[9px] font-mono tracking-widest text-[#554C5C] uppercase">
                    {metric.label}
                  </span>
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${metric.dot} ${
                      metric.isSuccess ? 'shadow-[0_0_5px_#39FF88]' : 'shadow-[0_0_5px_#A855F7]'
                    }`}
                  />
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <span className={`text-sm sm:text-base font-mono font-bold tracking-tight ${metric.color}`}>
                    {metric.value}
                  </span>
                  <span className="text-[9px] font-mono text-[#756B7D] tracking-wider uppercase">
                    {metric.tag}
                  </span>
                </div>
              </GlassPanel>
            ))}
          </div>

          {/* ============================================================ */}
          {/* 2 & 3. COMMAND CENTER HERO & MISSION CONSOLE                  */}
          {/* ============================================================ */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch w-full">
            {/* Left Column: NEXORA Core Computational Intelligence Unit */}
            <div className="lg:col-span-5 flex flex-col items-center justify-center p-6 sm:p-8 rounded-xl bg-[#050508]/85 border border-[rgba(168,85,247,0.10)] relative overflow-hidden shadow-[0_16px_48px_rgba(0,0,0,0.85)]">
              {/* Corner Coordinate Badges */}
              <div className="absolute top-3 left-3 text-[9px] font-mono text-[#554C5C] tracking-widest">
                CORE // 0x7E3F
              </div>
              <div className="absolute top-3 right-3 text-[9px] font-mono text-[#554C5C] tracking-widest">
                FREQ // 4.88 GHz
              </div>
              <div className="absolute bottom-3 left-3 text-[9px] font-mono text-[#554C5C] tracking-widest">
                BUS // AIR-GAPPED
              </div>
              <div className="absolute bottom-3 right-3 text-[9px] font-mono text-[#554C5C] tracking-widest">
                NEURAL // STABLE
              </div>

              {/* Central NEXORA Core Element */}
              <div className="my-2 relative">
                <NexoraCore state={coreState} size="md" />

                {/* Micro Status Chip */}
                <div className="absolute -bottom-1 left-1/2 -translate-x-1/2">
                  <TechnicalLabel variant={backendConnected ? 'primary' : 'default'} size="xs">
                    {backendConnected ? 'CORE ONLINE // LINKED' : 'CORE STANDBY // LOCAL'}
                  </TechnicalLabel>
                </div>
              </div>

              {/* Core Identifier */}
              <div className="text-center mt-3">
                <h2 className="text-2xl font-black font-mono tracking-tight text-[#F5F1FA]">
                  NEXORA
                </h2>
                <p className="text-[10px] font-mono tracking-widest uppercase text-[#756B7D] mt-0.5">
                  Autonomous AI Mission OS
                </p>
              </div>

              {/* State Previewer Switcher */}
              <div className="mt-4 flex flex-wrap items-center justify-center gap-1.5">
                {['idle', 'thinking', 'executing', 'verifying'].map((st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setCoreState(st)}
                    className={`text-[9px] font-mono uppercase px-2 py-0.5 rounded border transition-all cursor-pointer ${
                      coreState === st
                        ? 'border-[rgba(192,132,252,0.4)] text-[#E9D5FF] bg-[#090710] shadow-[0_0_8px_rgba(168,85,247,0.15)]'
                        : 'border-[rgba(168,85,247,0.08)] text-[#554C5C] hover:text-[#B8ADBF] bg-[#020203]'
                    }`}
                  >
                    {st}
                  </button>
                ))}
              </div>
            </div>

            {/* Right Column: Mission Control Hero Area (Dominant Interaction) */}
            <div className={`lg:col-span-7 flex flex-col justify-between p-6 sm:p-8 rounded-xl bg-[#07060B]/90 border border-[rgba(168,85,247,0.12)] shadow-[0_16px_48px_rgba(0,0,0,0.85)] relative transition-all duration-300 ${
              submissionState === 'success' ? 'border-l-2 border-l-[#39FF88]' : 'border-l-2 border-l-[#A855F7]'
            }`}>
              {submissionState === 'success' && createdMission ? (
                /* ======================================================== */
                /* SUCCESS VIEW: MISSION ACCEPTED & QUEUED IN PIPELINE      */
                /* ======================================================== */
                <div>
                  {/* Console Top Header */}
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-[#39FF88] shadow-[0_0_8px_#39FF88] animate-pulse" />
                      <span className="text-[10px] font-mono tracking-widest uppercase text-[#39FF88]">
                        MISSION ACCEPTED // DISPATCH ACTIVE
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
                    Autonomous cluster received your operational directive. Pipeline initialized and enqueued for agent reasoning.
                  </p>

                  {/* Mission Metadata Strip */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 my-4 p-3.5 rounded-lg bg-[#050508] border border-[rgba(168,85,247,0.14)]">
                    <div>
                      <span className="text-[9px] font-mono uppercase tracking-wider text-[#554C5C] block mb-1">
                        Mission ID
                      </span>
                      <span className="text-xs font-mono font-bold text-[#E9D5FF] select-all truncate block">
                        {createdMission?.id || 'PENDING'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[9px] font-mono uppercase tracking-wider text-[#554C5C] block mb-1">
                        Status
                      </span>
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-[rgba(57,255,136,0.1)] border border-[rgba(57,255,136,0.25)] text-[#39FF88]">
                        <span className="h-1.5 w-1.5 rounded-full bg-[#39FF88] shadow-[0_0_4px_#39FF88]" />
                        {createdMission?.status ? createdMission.status.toUpperCase() : 'QUEUED'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[9px] font-mono uppercase tracking-wider text-[#554C5C] block mb-1">
                        Queued At
                      </span>
                      <span className="text-xs font-mono text-[#B8ADBF] block">
                        {createdMission?.createdAt ? new Date(createdMission.createdAt).toLocaleTimeString() : 'JUST NOW'}
                      </span>
                    </div>
                  </div>

                  {/* Objective Display (Preserves multiline text) */}
                  <div className="rounded-lg bg-[#050508] border border-[rgba(168,85,247,0.12)] p-3.5 mb-4">
                    <div className="flex items-center gap-2 mb-2 select-none">
                      <span className="text-[#C084FC] font-mono text-xs">nx://objective &gt;</span>
                      <span className="text-[10px] font-mono text-[#554C5C]">ASSIGNED_DIRECTIVE</span>
                    </div>
                    <p className="text-xs sm:text-sm font-mono text-[#F5F1FA] whitespace-pre-wrap leading-relaxed">
                      {createdMission?.objective || missionDirective}
                    </p>
                  </div>

                  {/* Autonomous Execution Pathway */}
                  <div className="p-3 rounded-lg bg-[#050508]/80 border border-[rgba(168,85,247,0.08)] mb-4">
                    <div className="flex items-center justify-between text-[9px] font-mono text-[#554C5C] mb-2 uppercase tracking-wider">
                      <span>Autonomous Execution Pipeline</span>
                      <span className="text-[#39FF88]">Mission Queued</span>
                    </div>
                    <div className="flex items-center gap-1.5 overflow-x-auto text-[10px] font-mono py-0.5 scrollbar-thin">
                      <span className="px-2 py-0.5 rounded bg-[rgba(57,255,136,0.15)] text-[#39FF88] border border-[rgba(57,255,136,0.3)] font-bold shrink-0">
                        MISSION
                      </span>
                      <span className="text-[#554C5C] shrink-0">→</span>
                      <span className="px-2 py-0.5 rounded bg-[#090710] text-[#A855F7] border border-[rgba(168,85,247,0.2)] shrink-0">
                        PLANNER
                      </span>
                      <span className="text-[#554C5C] shrink-0">→</span>
                      <span className="px-2 py-0.5 rounded bg-[#020203] text-[#756B7D] shrink-0">TASKS</span>
                      <span className="text-[#554C5C] shrink-0">→</span>
                      <span className="px-2 py-0.5 rounded bg-[#020203] text-[#756B7D] shrink-0">AGENTS</span>
                      <span className="text-[#554C5C] shrink-0">→</span>
                      <span className="px-2 py-0.5 rounded bg-[#020203] text-[#756B7D] shrink-0">EVIDENCE</span>
                      <span className="text-[#554C5C] shrink-0">→</span>
                      <span className="px-2 py-0.5 rounded bg-[#020203] text-[#756B7D] shrink-0">CRITIC</span>
                      <span className="text-[#554C5C] shrink-0">→</span>
                      <span className="px-2 py-0.5 rounded bg-[#020203] text-[#756B7D] shrink-0">BUILDER</span>
                      <span className="text-[#554C5C] shrink-0">→</span>
                      <span className="px-2 py-0.5 rounded bg-[#020203] text-[#756B7D] shrink-0">QA</span>
                      <span className="text-[#554C5C] shrink-0">→</span>
                      <span className="px-2 py-0.5 rounded bg-[#020203] text-[#756B7D] shrink-0">RESULT</span>
                    </div>
                  </div>

                  {/* Console Success Footer */}
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pt-3 border-t border-[rgba(168,85,247,0.10)]">
                    <div className="flex items-center gap-2 text-[10px] font-mono text-[#756B7D]">
                      <span className="h-1.5 w-1.5 rounded-full bg-[#39FF88]" />
                      <span>MISSION LOCKED // READY FOR PLANNER DISPATCH</span>
                    </div>

                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={handleResetMission}
                        className="inline-flex items-center gap-2 rounded-lg bg-[#090710] border border-[rgba(168,85,247,0.3)] px-4 py-2 text-xs font-mono font-bold text-[#E9D5FF] hover:bg-[#0E0D14] hover:border-[rgba(192,132,252,0.5)] hover:text-[#F5F1FA] transition-all cursor-pointer"
                      >
                        <span>+ CREATE ANOTHER MISSION</span>
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                /* ======================================================== */
                /* COMPOSER VIEW: DIRECTIVE INPUT & SUBMISSION              */
                /* ======================================================== */
                <>
                  <div>
                    {/* Console Top Header */}
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <span className="h-1.5 w-1.5 rounded-full bg-[#A855F7] animate-pulse" />
                        <span className="text-[10px] font-mono tracking-widest uppercase text-[#C084FC]">
                          COMMAND DIRECTIVE // TERMINAL ENTRY
                        </span>
                      </div>
                      <TechnicalLabel variant="default" size="xs">
                        ENCLAVE 01
                      </TechnicalLabel>
                    </div>

                    {/* Dominant Focal Question */}
                    <h1 className="text-xl sm:text-2xl md:text-3xl font-mono font-bold tracking-tight text-[#F5F1FA] mb-2 leading-tight">
                      WHAT SHOULD NEXORA ACCOMPLISH?
                    </h1>

                    {/* Description */}
                    <p className="text-xs sm:text-sm text-[#756B7D] leading-relaxed mb-5 max-w-xl">
                      Assign an operational directive to the autonomous cluster. System agents will coordinate deep research, synthesize evidence, and execute verified workflows.
                    </p>

                    {/* Tactical Command Input Box */}
                    <div className="relative rounded-lg bg-[#050508] border border-[rgba(168,85,247,0.14)] focus-within:border-[rgba(192,132,252,0.45)] focus-within:shadow-[0_0_20px_rgba(168,85,247,0.12)] transition-all p-3 sm:p-4 mb-3">
                      <div className="flex items-center justify-between mb-2 select-none">
                        <div className="flex items-center gap-2">
                          <span className="text-[#C084FC] font-mono text-xs">nx://directive &gt;</span>
                          <span className="text-[10px] font-mono text-[#554C5C]">AUTONOMOUS_PIPELINE</span>
                        </div>
                        <span className="text-[9px] font-mono text-[#554C5C]">
                          Ctrl+Enter / ⌘+Enter to dispatch
                        </span>
                      </div>
                      <textarea
                        rows="3"
                        value={missionDirective}
                        onChange={(e) => {
                          setMissionDirective(e.target.value);
                          if (submissionError) setSubmissionError(null);
                          if (submissionState === 'error') setSubmissionState('idle');
                        }}
                        onKeyDown={(e) => {
                          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                            e.preventDefault();
                            handleRunMission();
                          }
                        }}
                        disabled={submissionState === 'processing'}
                        placeholder="Enter mission objective (e.g. Audit autonomous workspace security vectors, synthesize agent telemetry, and scaffold verification tests)..."
                        className="w-full bg-transparent text-sm font-mono text-[#F5F1FA] placeholder-[#554C5C] focus:outline-none resize-none leading-relaxed disabled:opacity-50"
                      />
                    </div>

                    {/* Inline Technical Error Notice */}
                    {submissionError && (
                      <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg bg-[rgba(239,68,68,0.08)] border border-[rgba(239,68,68,0.25)] text-xs font-mono text-[#FCA5A5] mb-3">
                        <span className="h-2 w-2 rounded-full bg-[#EF4444] animate-ping shrink-0" />
                        <span className="font-semibold text-[#F87171] shrink-0">ERROR:</span>
                        <span>{submissionError}</span>
                      </div>
                    )}
                  </div>

                  {/* Console Execution Footer */}
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
                    <button
                      type="button"
                      onClick={handleRunMission}
                      disabled={submissionState === 'processing'}
                      className={`group relative inline-flex items-center justify-center gap-2.5 overflow-hidden rounded-lg px-6 py-2.5 text-xs sm:text-sm font-bold font-mono tracking-wider transition-all duration-300 cursor-pointer ${
                        submissionState === 'processing'
                          ? 'bg-[#090710] border border-[rgba(168,85,247,0.3)] text-[#C084FC] cursor-not-allowed opacity-80'
                          : submissionState === 'error'
                          ? 'bg-[#180A0E] border border-[rgba(239,68,68,0.45)] text-[#FCA5A5] hover:border-[rgba(239,68,68,0.7)] shadow-[0_0_15px_rgba(239,68,68,0.15)] active:scale-[0.98]'
                          : 'bg-[#090710] border border-[rgba(168,85,247,0.45)] border-t-[rgba(233,213,255,0.30)] text-[#E9D5FF] shadow-[0_0_15px_rgba(168,85,247,0.18)] hover:bg-[#0E0D14] hover:border-[rgba(192,132,252,0.60)] hover:text-[#F5F1FA] hover:shadow-[0_0_22px_rgba(168,85,247,0.28)] active:scale-[0.98]'
                      }`}
                    >
                      {submissionState === 'processing' && (
                        <>
                          <svg className="animate-spin w-4 h-4 text-[#C084FC]" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          <span>INITIALIZING...</span>
                        </>
                      )}

                      {submissionState === 'error' && (
                        <>
                          <svg className="w-4 h-4 text-[#FCA5A5]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                          </svg>
                          <span>RETRY MISSION</span>
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
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* ============================================================ */}
          {/* 5. CONNECTED AUTONOMOUS AGENT SYSTEM MODULES                */}
          {/* ============================================================ */}
          <div className="w-full">
            <div className="flex items-center justify-between mb-3 px-1">
              <div className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-[#A855F7]" />
                <span className="text-[10px] font-mono tracking-widest text-[#756B7D] uppercase">
                  SYSTEM MODULES // AUTONOMOUS AGENT CLUSTER (06 ONLINE)
                </span>
              </div>
              <span className="text-[9px] font-mono text-[#554C5C]">
                PARALLEL COORDINATION NOMINAL
              </span>
            </div>

            {/* 6 Connected Modules Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {agentModules.map((agent) => (
                <GlassPanel key={agent.name} className="p-3.5 flex flex-col justify-between">
                  <div>
                    {/* Module ID & Status Indicator */}
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[9px] font-mono text-[#554C5C] tracking-wider">
                        {agent.id}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-[#A855F7] shadow-[0_0_5px_#A855F7]" />
                        <span className="text-[9px] font-mono text-[#C084FC] uppercase tracking-wider font-semibold">
                          {agent.status}
                        </span>
                      </div>
                    </div>

                    {/* Agent Name & Icon */}
                    <div className="flex items-center gap-2.5 mb-1.5">
                      <div className="p-1.5 rounded bg-[#090710] border border-[rgba(168,85,247,0.12)] text-[#C084FC]">
                        {agent.icon}
                      </div>
                      <h3 className="text-xs sm:text-sm font-mono font-bold text-[#F5F1FA] tracking-tight">
                        {agent.name}
                      </h3>
                    </div>

                    {/* Short Role */}
                    <p className="text-[11px] font-mono text-[#756B7D] leading-snug mb-3">
                      {agent.role}
                    </p>
                  </div>

                  {/* Activity Telemetry Footer */}
                  <div className="pt-2 border-t border-[rgba(168,85,247,0.08)] flex items-center justify-between text-[9px] font-mono text-[#554C5C]">
                    <span>STATUS</span>
                    <span className="text-[#B8ADBF] truncate max-w-[170px]">
                      {agent.activity}
                    </span>
                  </div>
                </GlassPanel>
              ))}
            </div>
          </div>

          {/* ============================================================ */}
          {/* BOTTOM TELEMETRY STATUS FOOTER                               */}
          {/* ============================================================ */}
          <footer className="w-full pt-4 border-t border-[rgba(168,85,247,0.10)] flex flex-col sm:flex-row items-center justify-between text-[10px] font-mono text-[#554C5C] gap-2">
            <div className="flex items-center gap-3">
              <span>NEXORA MISSION OS</span>
              <span>•</span>
              <span className="text-[#C084FC]">
                {createdMission
                  ? `ACTIVE MISSION: ${createdMission.id}`
                  : backendHealth?.message
                  ? `BACKEND: ${backendHealth.message}`
                  : 'STANDBY TELEMETRY'}
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
