import StatusIndicator from './StatusIndicator';

export default function Topbar({ onToggleSidebar, backendConnected = true }) {
  return (
    <header className="sticky top-0 z-30 w-full h-16 px-4 sm:px-8 border-b border-[rgba(168,85,247,0.12)] bg-[#020203]/92 backdrop-blur-md flex items-center justify-between">
      {/* Left Section: Mobile Toggle + Title + Status */}
      <div className="flex items-center gap-3 sm:gap-5">
        {/* Mobile Hamburger Button */}
        <button
          type="button"
          onClick={onToggleSidebar}
          className="md:hidden p-2 rounded-lg text-[#756B7D] hover:text-[#F5F1FA] hover:bg-[#050508] border border-[rgba(168,85,247,0.10)] transition-colors cursor-pointer"
          aria-label="Open sidebar"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        {/* Workspace Title & Sector Tag */}
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-sm sm:text-base font-bold font-mono tracking-wider text-[#F5F1FA]">
              MISSION CONTROL
            </h1>
            <span className="hidden sm:inline-block text-[9px] font-mono text-[#554C5C] bg-[#050508] px-1.5 py-0.5 rounded border border-[rgba(168,85,247,0.08)]">
              NODE.01
            </span>
          </div>
        </div>

        <span className="hidden sm:inline text-[rgba(168,85,247,0.12)]">/</span>

        {/* Real-time System Status Indicator */}
        <div className="hidden xs:flex items-center">
          <StatusIndicator
            state={backendConnected ? 'success' : 'warning'}
            label={backendConnected ? 'ALL SYSTEMS OPERATIONAL' : 'LOCAL BACKEND OFFLINE'}
          />
        </div>
      </div>

      {/* Right Section: Tactical User & Telemetry Pill */}
      <div className="flex items-center gap-3">
        <div className="hidden md:flex items-center gap-2 px-3 py-1 rounded-lg bg-[#050508] border border-[rgba(168,85,247,0.10)] text-[10px] font-mono text-[#756B7D]">
          <span>LINK:</span>
          <span className="text-[#C084FC] flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-[#A855F7] shadow-[0_0_5px_#A855F7]" />
            SECURE
          </span>
        </div>

        {/* User / Operator Avatar Placeholder */}
        <div className="relative cursor-pointer group">
          <div className="h-9 w-9 rounded-lg bg-[#050508] border border-[rgba(168,85,247,0.12)] p-[2px] transition-all duration-200 group-hover:border-[rgba(192,132,252,0.4)] group-hover:shadow-[0_0_12px_rgba(168,85,247,0.15)] flex items-center justify-center">
            <div className="h-full w-full rounded-md bg-[#020203] flex items-center justify-center">
              <span className="text-xs font-mono font-bold text-[#C084FC]">OP</span>
            </div>
          </div>
          <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-[#39FF88] ring-2 ring-[#020203]" />
        </div>
      </div>
    </header>
  );
}
