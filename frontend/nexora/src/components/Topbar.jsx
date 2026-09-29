import { motion } from 'motion/react';
import StatusIndicator from './StatusIndicator';
import { Link } from '../router/RouterContext';
import { useAuth } from '../context/AuthContext';

export default function Topbar({ onToggleSidebar, backendConnected = true }) {
  const { user, isAuthenticated, isLoading, logout } = useAuth();

  // Derive operator initials
  const getInitials = () => {
    if (user?.name) {
      const parts = user.name.trim().split(/\s+/);
      return parts.length >= 2
        ? (parts[0][0] + parts[1][0]).toUpperCase()
        : user.name.slice(0, 2).toUpperCase();
    }
    if (user?.email) return user.email.slice(0, 2).toUpperCase();
    return 'OP';
  };

  return (
    <header className="sticky top-0 z-30 w-full h-16 px-4 sm:px-8 border-b border-[rgba(168,85,247,0.12)] bg-[#020203]/92 backdrop-blur-md flex items-center justify-between">
      {/* Left Section: Mobile Toggle + Title + Status */}
      <div className="flex items-center gap-3 sm:gap-5">
        {/* Mobile Hamburger Button */}
        <motion.button
          type="button"
          onClick={onToggleSidebar}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className="md:hidden p-2 rounded-lg text-[#756B7D] hover:text-[#F5F1FA] hover:bg-[#050508] border border-[rgba(168,85,247,0.10)] transition-colors cursor-pointer"
          aria-label="Open sidebar"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </motion.button>

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

        {/* Operator Authentication Control */}
        {isLoading ? (
          <div className="flex items-center gap-2 px-2.5 py-1 text-[10px] font-mono text-[#756B7D]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#A855F7] animate-pulse" />
            <span>SYNCING...</span>
          </div>
        ) : isAuthenticated ? (
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Operator Identifier & Authenticated Beacon */}
            <div className="hidden sm:flex flex-col items-end">
              <span
                className="text-[11px] font-mono font-medium text-[#F5F1FA] max-w-[130px] truncate"
                title={user?.name || user?.email}
              >
                {user?.name || user?.email}
              </span>
              <span className="text-[9px] font-mono text-[#39FF88] flex items-center gap-1">
                <span className="h-1 w-1 rounded-full bg-[#39FF88] shadow-[0_0_4px_#39FF88]" />
                AUTHENTICATED
              </span>
            </div>

            {/* Authenticated Avatar */}
            <div
              className="h-9 w-9 rounded-lg bg-[#050508] border border-[rgba(168,85,247,0.25)] p-[2px] shadow-[0_0_12px_rgba(168,85,247,0.15)] flex items-center justify-center relative select-none"
              title={`Authenticated Operator: ${user?.name || user?.email}`}
            >
              <div className="h-full w-full rounded-md bg-[#090710] flex items-center justify-center">
                <span className="text-xs font-mono font-bold text-[#C084FC]">{getInitials()}</span>
              </div>
              <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-[#39FF88] ring-2 ring-[#020203]" />
            </div>

            {/* Logout Action */}
            <motion.button
              type="button"
              onClick={logout}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              className="px-2.5 py-1 rounded-lg bg-[#050508] border border-[rgba(239,68,68,0.25)] hover:border-[rgba(239,68,68,0.5)] hover:bg-[rgba(239,68,68,0.08)] text-[10px] font-mono text-[#F87171] hover:text-[#EF4444] transition-colors cursor-pointer"
              title="Terminate operator session"
            >
              LOGOUT
            </motion.button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Link
              to="/login"
              className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#050508] border border-[rgba(168,85,247,0.14)] hover:border-[rgba(192,132,252,0.4)] text-[10px] font-mono text-[#C084FC] hover:text-[#F5F1FA] transition-colors cursor-pointer"
            >
              <span>OPERATOR ACCESS</span>
              <span className="text-[#A855F7]">›</span>
            </Link>

            <Link
              to="/login"
              title="Operator Authentication // System Access"
              aria-label="Operator Authentication // System Access"
            >
              <motion.div
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.96 }}
                transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                className="relative cursor-pointer group"
              >
                <div className="h-9 w-9 rounded-lg bg-[#050508] border border-[rgba(168,85,247,0.12)] p-[2px] transition-all duration-200 group-hover:border-[rgba(192,132,252,0.4)] group-hover:shadow-[0_0_12px_rgba(168,85,247,0.15)] flex items-center justify-center">
                  <div className="h-full w-full rounded-md bg-[#020203] flex items-center justify-center">
                    <span className="text-xs font-mono font-bold text-[#C084FC]">OP</span>
                  </div>
                </div>
                <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-[#554C5C] ring-2 ring-[#020203]" />
              </motion.div>
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}
