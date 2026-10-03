import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import TechnicalLabel from '../TechnicalLabel';
import { fadeIn } from '../../motion/variants';
import { springs } from '../../motion/transitions';

/**
 * AuditInspector
 * Deep inspection harness for the autonomous audit pipeline:
 * 1. QA Verification & Invariant Checks
 * 2. Critic Logic Audit & Citation Integrity
 * 3. Analyst Structured Findings & Gap Analysis
 */
export default function AuditInspector({
  qa = null,
  critique = [],
  analysis = [],
  resultStatus = null,
}) {
  const [activeSubTab, setActiveSubTab] = useState('qa');

  // Normalize critique & analysis (which can be array or single object)
  const critiqueList = Array.isArray(critique) ? critique : critique ? [critique] : [];
  const analysisList = Array.isArray(analysis) ? analysis : analysis ? [analysis] : [];

  const primaryCritique = critiqueList[0] || null;
  const primaryAnalysis = analysisList[0] || null;

  const getVerdictBadge = (verdict) => {
    const v = (verdict || '').toLowerCase();
    if (v === 'pass') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-[rgba(57,255,136,0.12)] border border-[rgba(57,255,136,0.3)] text-[#39FF88]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#39FF88]" />
          PASS
        </span>
      );
    }
    if (v === 'needs_revision') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-[rgba(245,158,11,0.12)] border border-[rgba(245,158,11,0.3)] text-[#F59E0B]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#F59E0B]" />
          NEEDS REVISION
        </span>
      );
    }
    if (v === 'fail') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-[rgba(239,68,68,0.12)] border border-[rgba(239,68,68,0.3)] text-[#EF4444]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#EF4444]" />
          FAIL
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-[#090710] border border-[rgba(168,85,247,0.15)] text-[#756B7D]">
        PENDING
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
      {/* Sub-Tabs Bar */}
      <div className="flex flex-wrap items-center gap-2 p-1.5 rounded-lg bg-[#07050E] border border-[rgba(168,85,247,0.14)]">
        <button
          type="button"
          onClick={() => setActiveSubTab('qa')}
          className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-mono font-bold transition-all cursor-pointer ${
            activeSubTab === 'qa'
              ? 'bg-[#150D27] text-[#F5F1FA] border border-[rgba(192,132,252,0.4)] shadow-[0_0_12px_rgba(168,85,247,0.2)]'
              : 'text-[#756B7D] hover:text-[#D8CFDE] hover:bg-[#0A0712] border border-transparent'
          }`}
        >
          <span>QA VERIFICATION</span>
          {qa ? (
            getVerdictBadge(qa.overallVerdict)
          ) : (
            <span className="text-[9px] font-mono text-[#554C5C] px-1.5 py-0.2 rounded border border-[rgba(168,85,247,0.1)]">
              PENDING
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('critique')}
          className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-mono font-bold transition-all cursor-pointer ${
            activeSubTab === 'critique'
              ? 'bg-[#150D27] text-[#F5F1FA] border border-[rgba(192,132,252,0.4)] shadow-[0_0_12px_rgba(168,85,247,0.2)]'
              : 'text-[#756B7D] hover:text-[#D8CFDE] hover:bg-[#0A0712] border border-transparent'
          }`}
        >
          <span>CRITIC AUDIT</span>
          {primaryCritique ? (
            getVerdictBadge(primaryCritique.overallVerdict)
          ) : (
            <span className="text-[9px] font-mono text-[#554C5C] px-1.5 py-0.2 rounded border border-[rgba(168,85,247,0.1)]">
              {critiqueList.length}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('analyst')}
          className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-mono font-bold transition-all cursor-pointer ${
            activeSubTab === 'analyst'
              ? 'bg-[#150D27] text-[#F5F1FA] border border-[rgba(192,132,252,0.4)] shadow-[0_0_12px_rgba(168,85,247,0.2)]'
              : 'text-[#756B7D] hover:text-[#D8CFDE] hover:bg-[#0A0712] border border-transparent'
          }`}
        >
          <span>ANALYST SYNTHESIS</span>
          {primaryAnalysis && primaryAnalysis.findings ? (
            <span className="text-[9px] font-mono text-[#C084FC] px-1.5 py-0.2 rounded bg-[#10091E] border border-[rgba(168,85,247,0.2)]">
              {primaryAnalysis.findings.length} findings
            </span>
          ) : (
            <span className="text-[9px] font-mono text-[#554C5C] px-1.5 py-0.2 rounded border border-[rgba(168,85,247,0.1)]">
              {analysisList.length}
            </span>
          )}
        </button>
      </div>

      {/* Sub-Tab 1: QA Verification */}
      {activeSubTab === 'qa' && (
        <div className="space-y-4">
          {!qa ? (
            <div className="p-6 rounded-lg bg-[#07050E] border border-[rgba(168,85,247,0.14)] text-center">
              <div className="flex items-center justify-center gap-2 mb-2">
                <span className="h-2 w-2 rounded-full bg-[#C084FC] animate-pulse" />
                <span className="text-xs font-mono font-bold uppercase tracking-wider text-[#C084FC]">
                  QA PENDING // VERIFICATION PENDING
                </span>
              </div>
              <p className="text-xs font-mono text-[#756B7D] max-w-md mx-auto leading-relaxed">
                QA validation report is not yet recorded for this mission. In deterministic 4-phase runs or pending pipelines, the artifact is presented while formal QA certification remains pending.
              </p>
              {resultStatus && (
                <div className="mt-4 pt-3 border-t border-[rgba(168,85,247,0.08)] flex items-center justify-center gap-3 text-[10px] font-mono text-[#554C5C]">
                  <span>READY: {String(resultStatus.ready).toUpperCase()}</span>
                  <span>•</span>
                  <span>VERIFICATION: {(resultStatus.verification || 'PENDING').toUpperCase()}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {/* QA Summary Banner */}
              <div className={`p-4 rounded-lg border ${
                qa.overallVerdict === 'pass'
                  ? 'bg-[#04120A] border-[rgba(57,255,136,0.25)]'
                  : qa.overallVerdict === 'needs_revision'
                  ? 'bg-[#140D05] border-[rgba(245,158,11,0.25)]'
                  : 'bg-[#140607] border-[rgba(239,68,68,0.25)]'
              }`}>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 mb-2 border-b border-white/5">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#F5F1FA]">
                      QA ASSURANCE GATEWAY
                    </span>
                    {getVerdictBadge(qa.overallVerdict)}
                  </div>
                  <div className="flex items-center gap-2 text-[9px] font-mono text-[#756B7D]">
                    <span>METHOD: {(qa.qaMethod || 'AI').toUpperCase()}</span>
                    {qa.taskId && <span>• TASK: {qa.taskId.slice(-8)}</span>}
                  </div>
                </div>

                {qa.summary && (
                  <p className="text-xs font-mono text-[#F5F1FA] leading-relaxed">
                    {qa.summary}
                  </p>
                )}
              </div>

              {/* QA Checks Table */}
              {qa.checks && qa.checks.length > 0 && (
                <div className="p-4 rounded-lg bg-[#07060B] border border-[rgba(168,85,247,0.12)]">
                  <div className="flex items-center justify-between pb-2 mb-3 border-b border-[rgba(168,85,247,0.08)]">
                    <span className="text-[10px] font-mono uppercase tracking-widest text-[#E9D5FF] font-bold">
                      INVARIANT CHECKS ({qa.checks.length})
                    </span>
                    <span className="text-[9px] font-mono text-[#554C5C]">DETERMINISTIC & HEURISTIC</span>
                  </div>

                  <div className="space-y-2">
                    {qa.checks.map((chk, idx) => (
                      <div
                        key={idx}
                        className="p-2.5 rounded bg-[#050508] border border-[rgba(168,85,247,0.06)] flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-mono font-bold text-[#A855F7]">
                              {chk.checkType}
                            </span>
                            <span className={`px-1.5 py-0.2 rounded text-[9px] font-mono font-bold uppercase ${
                              chk.status === 'pass'
                                ? 'text-[#39FF88] bg-[#39FF88]/10'
                                : chk.status === 'warn'
                                ? 'text-[#F59E0B] bg-[#F59E0B]/10'
                                : 'text-[#EF4444] bg-[#EF4444]/10'
                            }`}>
                              {chk.status}
                            </span>
                          </div>
                          <p className="text-xs font-mono text-[#C4B7CB]">
                            {chk.message}
                          </p>
                        </div>

                        {chk.evidenceIds && chk.evidenceIds.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1 shrink-0">
                            {chk.evidenceIds.map((eid, eidx) => (
                              <span
                                key={eidx}
                                className="px-1.5 py-0.5 rounded text-[8.5px] font-mono bg-[#140C24] text-[#C084FC]"
                              >
                                #{eid.slice(-6)}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Warnings / Violations if any */}
              {((qa.missingRequirements && qa.missingRequirements.length > 0) ||
                (qa.unsupportedFindings && qa.unsupportedFindings.length > 0) ||
                (qa.warnings && qa.warnings.length > 0)) && (
                <div className="p-4 rounded-lg bg-[#0F0808] border border-[rgba(239,68,68,0.2)] space-y-2">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-[#EF4444] font-bold flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#EF4444]" />
                    <span>FLAGGED INVARIANTS & WARNINGS</span>
                  </div>

                  {qa.missingRequirements && qa.missingRequirements.length > 0 && (
                    <div className="text-xs font-mono text-[#FCA5A5]">
                      <span className="font-bold text-[#EF4444]">Missing Requirements: </span>
                      {qa.missingRequirements.join(', ')}
                    </div>
                  )}

                  {qa.unsupportedFindings && qa.unsupportedFindings.length > 0 && (
                    <div className="text-xs font-mono text-[#FCA5A5]">
                      <span className="font-bold text-[#EF4444]">Unsupported Findings: </span>
                      {qa.unsupportedFindings.join(', ')}
                    </div>
                  )}

                  {qa.warnings && qa.warnings.length > 0 && (
                    <ul className="text-xs font-mono text-[#FCD34D] space-y-1 pt-1">
                      {qa.warnings.map((w, widx) => (
                        <li key={widx}>• {w}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Sub-Tab 2: Critic Audit */}
      {activeSubTab === 'critique' && (
        <div className="space-y-4">
          {!primaryCritique ? (
            <div className="p-6 rounded-lg bg-[#07050E] border border-[rgba(168,85,247,0.14)] text-center">
              <div className="flex items-center justify-center gap-2 mb-2">
                <span className="h-2 w-2 rounded-full bg-[#756B7D]" />
                <span className="text-xs font-mono font-bold uppercase tracking-wider text-[#756B7D]">
                  NO CRITIQUE LOGGED // CRITIC STANDBY
                </span>
              </div>
              <p className="text-xs font-mono text-[#554C5C] max-w-md mx-auto leading-relaxed">
                The Critic agent did not output a critique payload for this execution cycle.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Critic Verdict Banner */}
              <div className="p-4 rounded-lg bg-[#07060B] border border-[rgba(168,85,247,0.14)]">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 mb-2 border-b border-[rgba(168,85,247,0.08)]">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#E9D5FF]">
                      CRITIC AUDIT REPORT
                    </span>
                    {getVerdictBadge(primaryCritique.overallVerdict)}
                  </div>
                  <div className="text-[9px] font-mono text-[#554C5C]">
                    METHOD: {(primaryCritique.critiqueMethod || 'AI').toUpperCase()}
                  </div>
                </div>

                {primaryCritique.summary && (
                  <p className="text-xs font-mono text-[#F5F1FA] leading-relaxed">
                    {primaryCritique.summary}
                  </p>
                )}

                {/* Citation Integrity Badge */}
                {primaryCritique.citationIntegrity && (
                  <div className="mt-3 pt-2.5 border-t border-[rgba(168,85,247,0.06)] flex flex-wrap items-center gap-3 text-[10px] font-mono">
                    <span className="text-[#554C5C]">CITATION INTEGRITY:</span>
                    <span className={primaryCritique.citationIntegrity.valid ? 'text-[#39FF88]' : 'text-[#EF4444]'}>
                      {primaryCritique.citationIntegrity.valid ? 'VALIDATED // ZERO ORPHANS' : 'INVALID REFERENCES FLAGGED'}
                    </span>
                    {primaryCritique.citationIntegrity.orphanReferenceCount > 0 && (
                      <span className="text-[#F59E0B]">
                        Orphans: {primaryCritique.citationIntegrity.orphanReferenceCount}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Finding Reviews */}
              {primaryCritique.findingReviews && primaryCritique.findingReviews.length > 0 && (
                <div className="p-4 rounded-lg bg-[#07060B] border border-[rgba(168,85,247,0.12)]">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-[#E9D5FF] font-bold pb-2 mb-3 border-b border-[rgba(168,85,247,0.08)]">
                    FINDING REVIEWS ({primaryCritique.findingReviews.length})
                  </div>
                  <div className="space-y-2.5">
                    {primaryCritique.findingReviews.map((review, idx) => (
                      <div
                        key={idx}
                        className="p-3 rounded bg-[#050508] border border-[rgba(168,85,247,0.06)]"
                      >
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <span className="text-[10px] font-mono font-bold text-[#A855F7]">
                            CHECK 0{idx + 1}
                          </span>
                          <span className={`px-1.5 py-0.2 rounded text-[9px] font-mono font-bold uppercase ${
                            review.verdict === 'supported'
                              ? 'text-[#39FF88] bg-[#39FF88]/10'
                              : review.verdict === 'partially_supported'
                              ? 'text-[#F59E0B] bg-[#F59E0B]/10'
                              : 'text-[#EF4444] bg-[#EF4444]/10'
                          }`}>
                            {review.verdict}
                          </span>
                        </div>
                        <p className="text-xs font-mono text-[#D8CFDE] leading-relaxed">
                          {review.statement}
                        </p>
                        {review.issues && review.issues.length > 0 && (
                          <div className="mt-2 text-[11px] font-mono text-[#F87171] bg-[#180A0B] p-2 rounded">
                            Issues: {review.issues.join('; ')}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Evidence Gaps */}
              {primaryCritique.evidenceGaps && primaryCritique.evidenceGaps.length > 0 && (
                <div className="p-3.5 rounded-lg bg-[#050508] border border-[rgba(168,85,247,0.1)]">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-[#F59E0B] font-bold mb-2">
                    IDENTIFIED EVIDENCE GAPS
                  </div>
                  <ul className="space-y-1">
                    {primaryCritique.evidenceGaps.map((gap, idx) => (
                      <li key={idx} className="text-xs font-mono text-[#D8CFDE] flex items-start gap-2">
                        <span className="text-[#F59E0B]">•</span>
                        <span>{gap}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Sub-Tab 3: Analyst Synthesis */}
      {activeSubTab === 'analyst' && (
        <div className="space-y-4">
          {!primaryAnalysis ? (
            <div className="p-6 rounded-lg bg-[#07050E] border border-[rgba(168,85,247,0.14)] text-center">
              <div className="flex items-center justify-center gap-2 mb-2">
                <span className="h-2 w-2 rounded-full bg-[#756B7D]" />
                <span className="text-xs font-mono font-bold uppercase tracking-wider text-[#756B7D]">
                  ANALYST PHASE DEFERRED // ZERO FINDINGS
                </span>
              </div>
              <p className="text-xs font-mono text-[#554C5C] max-w-md mx-auto leading-relaxed">
                The Analyst agent did not persist structured synthesis records for this mission packet.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Analyst Header */}
              <div className="flex items-center justify-between p-3 rounded-lg bg-[#07060B] border border-[rgba(168,85,247,0.14)]">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-[#A855F7]" />
                  <span className="text-xs font-mono font-bold text-[#E9D5FF] uppercase">
                    STRUCTURED SYNTHESIS ({primaryAnalysis.findings?.length || 0} CLAIMS)
                  </span>
                </div>
                <div className="text-[9px] font-mono text-[#554C5C]">
                  METHOD: {(primaryAnalysis.analysisMethod || 'AI').toUpperCase()}
                </div>
              </div>

              {/* Findings */}
              {primaryAnalysis.findings && primaryAnalysis.findings.length > 0 && (
                <div className="space-y-2">
                  {primaryAnalysis.findings.map((f, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-lg bg-[#07060B] border border-[rgba(168,85,247,0.1)]"
                    >
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <span className="text-[10px] font-mono font-bold text-[#C084FC]">
                          SYNTHESIS CLAIM 0{idx + 1}
                        </span>
                        <span className="text-[9px] font-mono text-[#38BDF8]">
                          {f.supportingEvidenceIds?.length || 0} supporting citations
                        </span>
                      </div>
                      <p className="text-xs font-mono text-[#F5F1FA] leading-relaxed">
                        {f.statement}
                      </p>
                      {f.supportingEvidenceIds && f.supportingEvidenceIds.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1 mt-2">
                          {f.supportingEvidenceIds.map((eid, eidx) => (
                            <span
                              key={eidx}
                              className="px-1.5 py-0.5 rounded text-[8.5px] font-mono bg-[#110920] text-[#C084FC]"
                            >
                              REF#{eid.slice(-6)}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Gaps & Contradictions */}
              {primaryAnalysis.gaps && primaryAnalysis.gaps.length > 0 && (
                <div className="p-3.5 rounded-lg bg-[#050508] border border-[rgba(168,85,247,0.1)]">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-[#756B7D] font-bold mb-2">
                    REASONING GAPS IDENTIFIED
                  </div>
                  <ul className="space-y-1">
                    {primaryAnalysis.gaps.map((g, idx) => (
                      <li key={idx} className="text-xs font-mono text-[#B8ADBF] flex items-start gap-2">
                        <span className="text-[#A855F7]">•</span>
                        <span>{g}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}
