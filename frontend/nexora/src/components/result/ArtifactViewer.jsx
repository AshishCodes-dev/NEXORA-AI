import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import TechnicalLabel from '../TechnicalLabel';
import { fadeIn, slideUp } from '../../motion/variants';
import { springs } from '../../motion/transitions';

/**
 * ArtifactViewer
 * High-precision inspection panel for the synthesized deliverable.
 * Renders title, executive summary, sections, key findings, limitations,
 * unresolved questions, and verified source citations.
 */
export default function ArtifactViewer({ artifact }) {
  const [copied, setCopied] = useState(false);

  if (!artifact) {
    return (
      <motion.div
        variants={fadeIn}
        initial="initial"
        animate="animate"
        className="p-6 rounded-lg bg-[#07050E] border border-[rgba(168,85,247,0.14)] text-center my-4"
      >
        <div className="flex items-center justify-center gap-2 mb-2">
          <span className="h-2 w-2 rounded-full bg-[#C084FC] animate-pulse" />
          <span className="text-xs font-mono font-bold uppercase tracking-wider text-[#C084FC]">
            SYNTHESIS PENDING // BUILDER STANDBY
          </span>
        </div>
        <p className="text-xs font-mono text-[#756B7D] max-w-md mx-auto leading-relaxed">
          The autonomous Builder agent has not yet generated a finalized artifact for this mission.
          Telemetry stream will populate here once synthesis completes.
        </p>
      </motion.div>
    );
  }

  const {
    title = 'Untitled Deliverable',
    artifactType = 'report',
    buildMethod = 'ai',
    executiveSummary = '',
    sections = [],
    keyFindings = [],
    limitations = [],
    unresolvedQuestions = [],
    sourceReferences = [],
  } = artifact;

  const handleCopyMarkdown = async () => {
    try {
      let md = `# ${title}\n\n`;
      md += `*Type: ${artifactType.toUpperCase()} | Method: ${buildMethod.toUpperCase()}*\n\n`;
      if (executiveSummary) {
        md += `## Executive Summary\n\n${executiveSummary}\n\n`;
      }
      if (keyFindings && keyFindings.length > 0) {
        md += `## Key Findings\n\n`;
        keyFindings.forEach((kf, idx) => {
          md += `${idx + 1}. **[${(kf.confidence || 'MED').toUpperCase()}]** ${kf.statement}\n`;
        });
        md += '\n';
      }
      if (sections && sections.length > 0) {
        sections.forEach((sec, idx) => {
          md += `## ${idx + 1}. ${sec.heading}\n\n${sec.content}\n\n`;
        });
      }
      if (limitations && limitations.length > 0) {
        md += `## Limitations\n\n`;
        limitations.forEach((lim) => {
          md += `- ${lim}\n`;
        });
        md += '\n';
      }
      if (unresolvedQuestions && unresolvedQuestions.length > 0) {
        md += `## Unresolved Questions\n\n`;
        unresolvedQuestions.forEach((uq) => {
          md += `- ${uq}\n`;
        });
        md += '\n';
      }
      if (sourceReferences && sourceReferences.length > 0) {
        md += `## Source References\n\n`;
        sourceReferences.forEach((ref) => {
          md += `- [${ref.sourceTitle || ref.sourceUrl}](${ref.sourceUrl})\n`;
        });
      }

      await navigator.clipboard.writeText(md);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      // Clipboard write failed fallback
    }
  };

  const getConfidenceBadge = (confidence = 'medium') => {
    const conf = confidence.toLowerCase();
    if (conf === 'high') {
      return (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase bg-[rgba(57,255,136,0.1)] border border-[rgba(57,255,136,0.3)] text-[#39FF88]">
          CONF // HIGH
        </span>
      );
    }
    if (conf === 'low') {
      return (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase bg-[rgba(239,68,68,0.1)] border border-[rgba(239,68,68,0.3)] text-[#EF4444]">
          CONF // LOW
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase bg-[rgba(245,158,11,0.1)] border border-[rgba(245,158,11,0.3)] text-[#F59E0B]">
        CONF // MED
      </span>
    );
  };

  return (
    <motion.div
      variants={fadeIn}
      initial="initial"
      animate="animate"
      className="space-y-4 my-2"
    >
      {/* 1. Header Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-lg bg-[#07050E] border border-[rgba(168,85,247,0.18)]">
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <TechnicalLabel variant="primary" size="xs">
              TYPE // {artifactType.toUpperCase()}
            </TechnicalLabel>
            <TechnicalLabel variant="default" size="xs">
              SYNTHESIS // {buildMethod.toUpperCase()}
            </TechnicalLabel>
            {artifact.taskId && (
              <span className="text-[10px] font-mono text-[#554C5C]">
                TASK: {artifact.taskId.slice(-8)}
              </span>
            )}
          </div>
          <h2 className="text-base sm:text-lg font-mono font-bold text-[#F5F1FA] tracking-tight leading-snug">
            {title}
          </h2>
        </div>

        <motion.button
          type="button"
          onClick={handleCopyMarkdown}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          transition={springs.tactile}
          className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded bg-[#100B1E] border border-[rgba(168,85,247,0.3)] text-[11px] font-mono font-bold text-[#E9D5FF] hover:bg-[#18112C] hover:border-[rgba(192,132,252,0.5)] transition-colors cursor-pointer self-start sm:self-auto shrink-0"
        >
          {copied ? (
            <>
              <svg className="w-3.5 h-3.5 text-[#39FF88]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
              <span className="text-[#39FF88]">COPIED DELIVERABLE</span>
            </>
          ) : (
            <>
              <svg className="w-3.5 h-3.5 text-[#C084FC]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75" />
              </svg>
              <span>COPY MARKDOWN</span>
            </>
          )}
        </motion.button>
      </div>

      {/* 2. Executive Summary */}
      {executiveSummary && (
        <div className="p-4 rounded-lg bg-[#07060B] border-l-2 border-l-[#C084FC] border border-[rgba(168,85,247,0.14)]">
          <div className="flex items-center gap-2 mb-2">
            <span className="h-1.5 w-1.5 rounded-full bg-[#C084FC]" />
            <span className="text-[10px] font-mono uppercase tracking-widest text-[#C084FC] font-bold">
              EXECUTIVE SYNTHESIS
            </span>
          </div>
          <p className="text-xs sm:text-sm font-mono text-[#F5F1FA] leading-relaxed whitespace-pre-line">
            {executiveSummary}
          </p>
        </div>
      )}

      {/* 3. Key Findings Grid */}
      {keyFindings && keyFindings.length > 0 && (
        <div className="rounded-lg bg-[#050508] border border-[rgba(168,85,247,0.12)] p-4">
          <div className="flex items-center justify-between pb-2 mb-3 border-b border-[rgba(168,85,247,0.08)]">
            <div className="flex items-center gap-2">
              <span className="text-[#38BDF8] font-mono text-xs">◆</span>
              <span className="text-[10px] font-mono uppercase tracking-widest text-[#E9D5FF] font-bold">
                KEY FINDINGS ({keyFindings.length})
              </span>
            </div>
            <span className="text-[9px] font-mono text-[#554C5C]">EMPIRICALLY GROUNDED</span>
          </div>

          <div className="space-y-2.5">
            {keyFindings.map((finding, idx) => (
              <div
                key={idx}
                className="p-3 rounded bg-[#090710] border border-[rgba(168,85,247,0.08)] hover:border-[rgba(168,85,247,0.2)] transition-colors"
              >
                <div className="flex items-start justify-between gap-3 mb-1.5">
                  <span className="text-[10px] font-mono font-bold text-[#A855F7]">
                    0{idx + 1} //
                  </span>
                  {getConfidenceBadge(finding.confidence)}
                </div>
                <p className="text-xs font-mono text-[#F5F1FA] leading-relaxed mb-2">
                  {finding.statement}
                </p>
                {finding.evidenceIds && finding.evidenceIds.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="text-[9px] font-mono text-[#554C5C] uppercase mr-1">
                      Cited Sources:
                    </span>
                    {finding.evidenceIds.map((eid, eidx) => (
                      <span
                        key={eidx}
                        className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-[#140C24] border border-[rgba(168,85,247,0.18)] text-[#C084FC]"
                      >
                        REF#{eid.slice(-6)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 4. Structured Sections */}
      {sections && sections.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 pt-2 px-1">
            <span className="text-[10px] font-mono tracking-widest text-[#756B7D] uppercase">
              STRUCTURED CONTENT SECTIONS ({sections.length})
            </span>
          </div>

          {sections.map((section, idx) => (
            <div
              key={idx}
              className="p-4 rounded-lg bg-[#07060B] border border-[rgba(168,85,247,0.12)] shadow-[0_4px_16px_rgba(0,0,0,0.4)]"
            >
              <div className="flex items-center justify-between pb-2 mb-2 border-b border-[rgba(168,85,247,0.08)]">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-[#A855F7] font-bold">
                    § 0{idx + 1}
                  </span>
                  <h3 className="text-xs sm:text-sm font-mono font-bold text-[#E9D5FF] tracking-tight">
                    {section.heading}
                  </h3>
                </div>
                {section.evidenceIds && section.evidenceIds.length > 0 && (
                  <span className="text-[9px] font-mono text-[#38BDF8]">
                    {section.evidenceIds.length} citations
                  </span>
                )}
              </div>

              <div className="text-xs font-mono text-[#D8CFDE] leading-relaxed whitespace-pre-line my-2">
                {section.content}
              </div>

              {section.evidenceIds && section.evidenceIds.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 pt-2 mt-2 border-t border-[rgba(168,85,247,0.06)]">
                  <span className="text-[9px] font-mono text-[#554C5C] uppercase">
                    Grounding Evidence:
                  </span>
                  {section.evidenceIds.map((eid, eidx) => (
                    <span
                      key={eidx}
                      className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-[#0D0818] border border-[rgba(168,85,247,0.15)] text-[#C084FC]"
                    >
                      EVID#{eid.slice(-6)}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 5. Limitations & Unresolved Questions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
        {/* Limitations */}
        <div className="p-3.5 rounded-lg bg-[#050508] border border-[rgba(168,85,247,0.1)]">
          <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-[rgba(168,85,247,0.06)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#F59E0B]" />
            <span className="text-[10px] font-mono uppercase tracking-widest text-[#F59E0B] font-bold">
              LIMITATIONS
            </span>
          </div>
          {limitations && limitations.length > 0 ? (
            <ul className="space-y-1.5">
              {limitations.map((lim, idx) => (
                <li key={idx} className="text-[11px] font-mono text-[#B8ADBF] flex items-start gap-2 leading-relaxed">
                  <span className="text-[#F59E0B] shrink-0 mt-0.5">—</span>
                  <span>{lim}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[10px] font-mono text-[#554C5C] italic">
              NO LIMITATIONS IDENTIFIED
            </p>
          )}
        </div>

        {/* Unresolved Questions */}
        <div className="p-3.5 rounded-lg bg-[#050508] border border-[rgba(168,85,247,0.1)]">
          <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-[rgba(168,85,247,0.06)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#38BDF8]" />
            <span className="text-[10px] font-mono uppercase tracking-widest text-[#38BDF8] font-bold">
              OPEN INQUIRIES
            </span>
          </div>
          {unresolvedQuestions && unresolvedQuestions.length > 0 ? (
            <ul className="space-y-1.5">
              {unresolvedQuestions.map((uq, idx) => (
                <li key={idx} className="text-[11px] font-mono text-[#B8ADBF] flex items-start gap-2 leading-relaxed">
                  <span className="text-[#38BDF8] shrink-0 mt-0.5">?</span>
                  <span>{uq}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[10px] font-mono text-[#554C5C] italic">
              NO UNRESOLVED QUESTIONS
            </p>
          )}
        </div>
      </div>

      {/* 6. Source References */}
      {sourceReferences && sourceReferences.length > 0 && (
        <div className="p-3.5 rounded-lg bg-[#050508] border border-[rgba(168,85,247,0.1)]">
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-[rgba(168,85,247,0.06)]">
            <span className="text-[10px] font-mono uppercase tracking-widest text-[#756B7D] font-bold">
              VERIFIED SOURCE REFERENCES ({sourceReferences.length})
            </span>
            <span className="text-[9px] font-mono text-[#554C5C]">SANITY CHECKED</span>
          </div>
          <div className="space-y-1.5">
            {sourceReferences.map((ref, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between gap-3 text-xs font-mono p-1.5 rounded bg-[#090710] border border-[rgba(168,85,247,0.06)]"
              >
                <div className="min-w-0 flex items-center gap-2">
                  <span className="text-[10px] text-[#A855F7] font-bold">[{idx + 1}]</span>
                  <span className="truncate text-[#E9D5FF] text-[11px]">
                    {ref.sourceTitle || ref.sourceUrl}
                  </span>
                </div>
                {ref.sourceUrl && (
                  <a
                    href={ref.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 text-[10px] font-mono text-[#38BDF8] hover:text-[#7DD3FC] underline flex items-center gap-1"
                  >
                    <span>VISIT</span>
                    <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}
