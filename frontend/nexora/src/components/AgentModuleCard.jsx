import { motion, useReducedMotion } from 'motion/react';
import GlassPanel from './GlassPanel';
import { staggerItem } from '../motion/variants';
import { springs } from '../motion/transitions';

/**
 * AgentModuleCard
 * Represents an autonomous agent in the NEXORA cluster.
 * Communicates active/idle state with subtle robotic scanning and border emphasis.
 */
export default function AgentModuleCard({
  agent,
  isActive = false,
  isSecondary = false,
  activeStateLabel = '',
}) {
  const prefersReducedMotion = useReducedMotion();

  const isHighlighted = isActive || isSecondary;

  return (
    <motion.div
      variants={staggerItem}
      whileHover={{ y: -2 }}
      transition={springs.subtle}
      className="h-full"
    >
      <GlassPanel
        className={`p-3.5 flex flex-col justify-between h-full relative overflow-hidden transition-all duration-300 ${
          isHighlighted
            ? 'border-[rgba(192,132,252,0.45)] border-l-2 border-l-[#A855F7] shadow-[0_0_22px_rgba(168,85,247,0.16)] bg-[#0A0713]/95'
            : 'border-[rgba(168,85,247,0.10)] bg-[#07060B]/86'
        }`}
      >
        {/* Subtle Robotic Scanning Bar (Active Agent Only, Task 8) */}
        {isHighlighted && !prefersReducedMotion && (
          <div className="absolute inset-x-0 top-0 h-[1.5px] overflow-hidden pointer-events-none">
            <motion.div
              className="h-full w-28 bg-gradient-to-r from-transparent via-[#C084FC] to-transparent shadow-[0_0_8px_#A855F7]"
              animate={{ x: ['-100%', '300%'] }}
              transition={{
                repeat: Infinity,
                duration: 1.8,
                ease: 'easeInOut',
              }}
            />
          </div>
        )}

        <div>
          {/* Module ID & Status Indicator */}
          <div className="flex items-center justify-between mb-2">
            <span
              className={`text-[9px] font-mono tracking-wider transition-colors ${
                isHighlighted ? 'text-[#C084FC] font-semibold' : 'text-[#554C5C]'
              }`}
            >
              {agent.id}
            </span>

            <div className="flex items-center gap-1.5">
              <span
                className={`h-1.5 w-1.5 rounded-full transition-all ${
                  isHighlighted
                    ? 'bg-[#39FF88] shadow-[0_0_6px_#39FF88] animate-pulse'
                    : 'bg-[#554C5C]'
                }`}
              />
              <span
                className={`text-[9px] font-mono uppercase tracking-wider font-semibold ${
                  isHighlighted ? 'text-[#39FF88]' : 'text-[#756B7D]'
                }`}
              >
                {isHighlighted ? (isActive ? 'ACTIVE' : 'LINKED') : 'STANDBY'}
              </span>
            </div>
          </div>

          {/* Agent Name & Icon */}
          <div className="flex items-center gap-2.5 mb-1.5">
            <div
              className={`p-1.5 rounded transition-all ${
                isHighlighted
                  ? 'bg-[#120B20] border border-[rgba(192,132,252,0.4)] text-[#E9D5FF] shadow-[0_0_10px_rgba(168,85,247,0.2)]'
                  : 'bg-[#090710] border border-[rgba(168,85,247,0.12)] text-[#756B7D]'
              }`}
            >
              {agent.icon}
            </div>
            <h3
              className={`text-xs sm:text-sm font-mono font-bold tracking-tight transition-colors ${
                isHighlighted ? 'text-[#F5F1FA]' : 'text-[#B8ADBF]'
              }`}
            >
              {agent.name}
            </h3>
          </div>

          {/* Short Role */}
          <p className="text-[11px] font-mono text-[#756B7D] leading-snug mb-3">
            {agent.role}
          </p>
        </div>

        {/* Activity Telemetry Footer */}
        <div className="pt-2 border-t border-[rgba(168,85,247,0.08)] flex items-center justify-between text-[9px] font-mono">
          <span className="text-[#554C5C]">STATUS</span>
          <span
            className={`truncate max-w-[170px] ${
              isHighlighted ? 'text-[#C084FC] font-semibold' : 'text-[#756B7D]'
            }`}
          >
            {isHighlighted
              ? (activeStateLabel || agent.activeActivity || 'EXECUTING DIRECTIVE')
              : agent.activity}
          </span>
        </div>
      </GlassPanel>
    </motion.div>
  );
}
