import { motion } from 'motion/react';
import { Link } from '../router/RouterContext';

export default function Sidebar({ isOpen, onClose }) {
  const navItems = [
    {
      name: 'Overview',
      active: true,
      tag: 'SYS.01',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
        </svg>
      ),
    },
    {
      name: 'Missions',
      active: false,
      tag: 'OPS',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
        </svg>
      ),
    },
    {
      name: 'Agents',
      active: false,
      tag: '03 ACT',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
          <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
        </svg>
      ),
    },
    {
      name: 'Knowledge',
      active: false,
      tag: 'VEC',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
        </svg>
      ),
    },
    {
      name: 'Activity',
      active: false,
      tag: 'STREAM',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" />
        </svg>
      ),
    },
  ];

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-[#010202]/92 backdrop-blur-sm md:hidden transition-opacity"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Mission OS Sidebar Shell: #020203 */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-[#020203] border-r border-[rgba(168,85,247,0.12)] backdrop-blur-xl flex flex-col justify-between p-4 transition-transform duration-300 ease-in-out md:static md:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div>
          {/* Brand Header */}
          <div className="flex items-center justify-between px-3 py-3 mb-6 border-b border-[rgba(168,85,247,0.10)] pb-5">
            <div className="flex items-center gap-3">
              {/* Tactical Logo Mark */}
              <div className="h-8 w-8 rounded-lg bg-[#050508] border border-[rgba(168,85,247,0.12)] flex items-center justify-center relative">
                <span className="font-mono font-black text-sm text-[#C084FC]">N</span>
                <span className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-[#A855F7] shadow-[0_0_5px_#A855F7]" />
              </div>
              <div>
                <span className="font-bold tracking-widest text-sm text-[#F5F1FA] block font-mono">
                  NEXORA
                </span>
                <span className="text-[10px] tracking-wider text-[#756B7D] uppercase font-mono block">
                  MISSION OS • v0.1
                </span>
              </div>
            </div>

            {/* Mobile Close Button */}
            <button
              type="button"
              onClick={onClose}
              className="md:hidden text-[#756B7D] hover:text-[#F5F1FA] p-1.5 rounded-lg hover:bg-[#07060B] transition-colors"
              aria-label="Close sidebar"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Navigation Section */}
          <div className="px-2 mb-2">
            <span className="text-[9px] font-mono tracking-widest uppercase text-[#554C5C]">
              CORE DIRECTIVES
            </span>
          </div>

          <nav className="space-y-1.5">
            {navItems.map((item) => (
              <motion.button
                key={item.name}
                type="button"
                whileHover={{ x: 2 }}
                whileTap={{ scale: 0.985 }}
                transition={{ type: 'spring', stiffness: 450, damping: 25 }}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors duration-200 cursor-pointer ${
                  item.active
                    ? 'bg-[#07060B] text-[#F5F1FA] border border-[rgba(192,132,252,0.38)] border-l-2 border-l-[#A855F7] shadow-[0_0_12px_rgba(168,85,247,0.10)]'
                    : 'text-[#756B7D] hover:text-[#B8ADBF] hover:bg-[#050508] hover:border-[rgba(168,85,247,0.08)] border border-transparent'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className={item.active ? 'text-[#C084FC]' : 'text-[#756B7D]'}>
                    {item.icon}
                  </span>
                  <span className="tracking-wide text-xs sm:text-sm font-medium">{item.name}</span>
                </div>
                <span
                  className={`text-[9px] font-mono tracking-wider px-1.5 py-0.5 rounded border ${
                    item.active
                      ? 'border-[rgba(168,85,247,0.30)] text-[#C084FC] bg-[#A855F7]/10'
                      : 'border-[rgba(168,85,247,0.07)] text-[#554C5C] bg-[#050508]'
                  }`}
                >
                  {item.tag}
                </span>
              </motion.button>
            ))}
          </nav>
        </div>

        {/* Footer: System Telemetry & Settings */}
        <div className="pt-4 border-t border-[rgba(168,85,247,0.10)]">
          {/* Micro Telemetry HUD in Sidebar */}
          <div className="mb-3 px-3 py-2 rounded-lg bg-[#050508] border border-[rgba(168,85,247,0.08)] flex items-center justify-between text-[10px] font-mono">
            <span className="text-[#554C5C]">CORE PROTOCOL</span>
            <span className="text-[#C084FC] flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[#A855F7] shadow-[0_0_5px_#A855F7] animate-pulse" />
              ONLINE
            </span>
          </div>

          {/* Operator Auth Link */}
          <Link
            to="/login"
            className="w-full flex items-center justify-between px-3.5 py-2 rounded-lg text-xs font-mono text-[#756B7D] hover:text-[#F5F1FA] hover:bg-[#050508] border border-transparent hover:border-[rgba(168,85,247,0.08)] transition-colors duration-200 cursor-pointer mb-1.5"
          >
            <div className="flex items-center gap-2.5">
              <svg className="w-4 h-4 text-[#A855F7]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
              </svg>
              <span>OPERATOR AUTH</span>
            </div>
            <span className="text-[9px] font-mono text-[#C084FC]">LOGIN</span>
          </Link>

          <motion.button
            type="button"
            whileHover={{ x: 2 }}
            whileTap={{ scale: 0.985 }}
            transition={{ type: 'spring', stiffness: 450, damping: 25 }}
            className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg text-xs font-mono text-[#756B7D] hover:text-[#F5F1FA] hover:bg-[#050508] border border-transparent hover:border-[rgba(168,85,247,0.08)] transition-colors duration-200 cursor-pointer"
          >
            <div className="flex items-center gap-2.5">
              <svg className="w-4 h-4 text-[#756B7D]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span>SETTINGS</span>
            </div>
            <span className="text-[9px] text-[#554C5C]">CONFIG</span>
          </motion.button>
        </div>
      </aside>
    </>
  );
}
