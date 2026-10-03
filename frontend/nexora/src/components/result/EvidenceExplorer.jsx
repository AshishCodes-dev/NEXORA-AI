import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import TechnicalLabel from '../TechnicalLabel';
import { fadeIn } from '../../motion/variants';

/**
 * EvidenceExplorer
 * Dedicated browser for all empirical evidence nodes gathered by the Research Agent.
 * Renders source title, target claim, empirical excerpt, timestamp, and domain origin.
 */
export default function EvidenceExplorer({ evidence = [] }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState(null);

  const safeEvidence = Array.isArray(evidence) ? evidence : [];

  const filteredEvidence = safeEvidence.filter((item) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const titleMatch = (item.sourceTitle || '').toLowerCase().includes(q);
    const claimMatch = (item.claim || '').toLowerCase().includes(q);
    const textMatch = (item.evidenceText || '').toLowerCase().includes(q);
    const urlMatch = (item.sourceUrl || '').toLowerCase().includes(q);
    return titleMatch || claimMatch || textMatch || urlMatch;
  });

  const handleCopyId = (id) => {
    if (!id) return;
    try {
      navigator.clipboard.writeText(id);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Ignore
    }
  };

  const getDomainFromUrl = (url) => {
    if (!url) return '';
    try {
      const parsed = new URL(url);
      return parsed.hostname.replace(/^www\./, '');
    } catch {
      return url.length > 30 ? url.slice(0, 30) + '...' : url;
    }
  };

  if (safeEvidence.length === 0) {
    return (
      <motion.div
        variants={fadeIn}
        initial="initial"
        animate="animate"
        className="p-6 rounded-lg bg-[#07050E] border border-[rgba(168,85,247,0.14)] text-center my-4"
      >
        <div className="flex items-center justify-center gap-2 mb-2">
          <span className="h-2 w-2 rounded-full bg-[#756B7D]" />
          <span className="text-xs font-mono font-bold uppercase tracking-wider text-[#756B7D]">
            NO EVIDENCE RECORDED // ZERO NODES
          </span>
        </div>
        <p className="text-xs font-mono text-[#554C5C] max-w-md mx-auto leading-relaxed">
          The research phase did not record external evidence items for this mission packet.
          All reasoning was conducted with existing internal knowledge.
        </p>
      </motion.div>
    );
  }

  return (
    <motion.div
      variants={fadeIn}
      initial="initial"
      animate="animate"
      className="space-y-3 my-2"
    >
      {/* Search & Metadata Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 p-3 rounded-lg bg-[#07050E] border border-[rgba(168,85,247,0.14)]">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-[#38BDF8]" />
          <span className="text-xs font-mono font-bold text-[#E9D5FF] uppercase tracking-wider">
            EVIDENCE REPOSITORY ({safeEvidence.length} NODES)
          </span>
        </div>

        <div className="relative w-full sm:w-64">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search evidence or claims..."
            className="w-full bg-[#050508] border border-[rgba(168,85,247,0.18)] rounded px-2.5 py-1 text-xs font-mono text-[#F5F1FA] placeholder:text-[#554C5C] focus:outline-none focus:border-[#C084FC] transition-colors"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-[#756B7D] hover:text-[#F5F1FA]"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Results Count indicator if filtering */}
      {searchQuery && (
        <div className="text-[10px] font-mono text-[#756B7D] px-1">
          Showing {filteredEvidence.length} of {safeEvidence.length} evidence items matching &ldquo;{searchQuery}&rdquo;
        </div>
      )}

      {/* Evidence Cards */}
      <div className="space-y-3">
        {filteredEvidence.map((item, idx) => {
          const domain = getDomainFromUrl(item.sourceUrl);
          const isCopied = copiedId === item.id;

          return (
            <div
              key={item.id || idx}
              className="p-4 rounded-lg bg-[#07060B] border border-[rgba(168,85,247,0.12)] hover:border-[rgba(168,85,247,0.25)] transition-all shadow-[0_4px_16px_rgba(0,0,0,0.5)]"
            >
              {/* Card Header */}
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2 mb-2 border-b border-[rgba(168,85,247,0.08)]">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleCopyId(item.id)}
                    title="Click to copy full Evidence ID"
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono bg-[#10091E] border border-[rgba(168,85,247,0.25)] text-[#C084FC] hover:bg-[#180E2E] transition-colors cursor-pointer"
                  >
                    <span>EVID#{item.id ? item.id.slice(-6) : `0${idx + 1}`}</span>
                    {isCopied && <span className="text-[#39FF88] text-[8px]">COPIED</span>}
                  </button>

                  <span className="text-xs font-mono font-bold text-[#F5F1FA]">
                    {item.sourceTitle || 'Untitled Source'}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {item.retrievedAt && (
                    <span className="text-[9px] font-mono text-[#554C5C]">
                      {new Date(item.retrievedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                  )}
                  {item.sourceUrl && (
                    <a
                      href={item.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[10px] font-mono text-[#38BDF8] hover:text-[#7DD3FC] px-1.5 py-0.5 rounded bg-[#06121E] border border-[#38BDF8]/20 transition-colors"
                    >
                      <span>{domain}</span>
                      <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </a>
                  )}
                </div>
              </div>

              {/* Target Claim */}
              {item.claim && (
                <div className="mb-2">
                  <div className="text-[9px] font-mono text-[#756B7D] uppercase tracking-wider mb-0.5">
                    TARGET CLAIM
                  </div>
                  <div className="text-xs font-mono text-[#E9D5FF] leading-relaxed">
                    {item.claim}
                  </div>
                </div>
              )}

              {/* Empirical Evidence Excerpt */}
              {item.evidenceText && (
                <div className="p-3 rounded bg-[#050508] border-l-2 border-l-[#38BDF8] border border-[rgba(168,85,247,0.08)] mt-2">
                  <div className="text-[9px] font-mono text-[#38BDF8] uppercase tracking-widest mb-1 flex items-center gap-1">
                    <span>EMPIRICAL EXCERPT</span>
                  </div>
                  <p className="text-xs font-mono text-[#C4B7CB] leading-relaxed italic whitespace-pre-wrap">
                    &ldquo;{item.evidenceText}&rdquo;
                  </p>
                </div>
              )}

              {/* Task Footnote */}
              {item.taskId && (
                <div className="mt-2 pt-1.5 flex items-center justify-end text-[9px] font-mono text-[#554C5C]">
                  <span>RECORDED BY TASK: {item.taskId.slice(-8)}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}
