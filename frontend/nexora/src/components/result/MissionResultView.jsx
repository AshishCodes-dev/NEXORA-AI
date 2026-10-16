import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import TechnicalLabel from '../TechnicalLabel';
import ArtifactViewer from './ArtifactViewer';
import EvidenceExplorer from './EvidenceExplorer';
import AuditInspector from './AuditInspector';
import { fadeIn, slideUp } from '../../motion/variants';
import { springs } from '../../motion/transitions';
import { cancelMission, retryTask } from '../../services/missionService';

/**
 * MissionResultView
 * Full authoritative mission inspection console.
 * Driven entirely by GET /api/missions/:missionId/result payload.
 */
export default function MissionResultView({
  missionResult = null,
  resultLoading = false,
  resultError = null,
  createdMission = null,
  onReset,
  onCancelMission,
  onRetryTask,
  onRefreshResult,
}) {
  const [activeTab, setActiveTab] = useState('deliverable');
  const [copiedId, setCopiedId] = useState(false);
  const [copiedJson, setCopiedJson] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [retryingTaskId, setRetryingTaskId] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [actionSuccess, setActionSuccess] = useState(null);

  const missionId = createdMission?.id || missionResult?.mission?.id || '';
  const objective = missionResult?.mission?.objective || createdMission?.objective || '';
  const tasks = missionResult?.tasks || [];
  const evidence = missionResult?.evidence || [];
  const artifact = missionResult?.artifact || null;
  const qa = missionResult?.qa || null;
  const critique = missionResult?.critique || [];
  const analysis = missionResult?.analysis || [];
  const resultStatus = missionResult?.resultStatus || null;
  const missionStatus = missionResult?.mission?.status || createdMission?.status || 'queued';

  const completedTasks = tasks.filter((t) => t.status === 'completed').length;
  const totalTasks = tasks.length;
  const taskProgressPercent = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const handleCopyMissionId = () => {
    if (!missionId) return;
    try {
      navigator.clipboard.writeText(missionId);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    } catch {
      // Ignore
    }
  };

  const handleCopyRawJson = () => {
    if (!missionResult) return;
    try {
      navigator.clipboard.writeText(JSON.stringify(missionResult, null, 2));
      setCopiedJson(true);
      setTimeout(() => setCopiedJson(false), 2000);
    } catch {
      // Ignore
    }
  };

  // Authoritative Status Pill Configuration
  const getStatusBadge = () => {
    const isReady = resultStatus?.ready === true;
    const verification = resultStatus?.verification;

    if (missionStatus === 'cancelled') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-mono font-bold uppercase bg-[rgba(239,68,68,0.12)] border border-[rgba(239,68,68,0.3)] text-[#F87171]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#EF4444]" />
          CANCELLED // OPERATOR ABORTED
        </span>
      );
    }

    if (missionStatus === 'failed' || verification === 'failed') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-mono font-bold uppercase bg-[rgba(239,68,68,0.12)] border border-[rgba(239,68,68,0.3)] text-[#EF4444]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#EF4444]" />
          FAILED // INVARIANTS VIOLATED
        </span>
      );
    }

    if (verification === 'verified') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-mono font-bold uppercase bg-[rgba(57,255,136,0.12)] border border-[rgba(57,255,136,0.3)] text-[#39FF88]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#39FF88] shadow-[0_0_6px_#39FF88]" />
          VERIFIED // ASSURANCES PASSED
        </span>
      );
    }

    if (verification === 'needs_revision') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-mono font-bold uppercase bg-[rgba(245,158,11,0.12)] border border-[rgba(245,158,11,0.3)] text-[#F59E0B]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#F59E0B]" />
          NEEDS REVISION // ISSUES FLAGGED
        </span>
      );
    }

    if (missionStatus === 'completed') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-mono font-bold uppercase bg-[rgba(192,132,252,0.12)] border border-[rgba(192,132,252,0.3)] text-[#C084FC]">
          <span className={`h-1.5 w-1.5 rounded-full ${qa ? 'bg-[#39FF88]' : 'bg-[#C084FC]'}`} />
          COMPLETED // {qa ? 'QA PASS' : 'QA PENDING'}
        </span>
      );
    }

    // Default Running / Active state
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-mono font-bold uppercase bg-[rgba(168,85,247,0.12)] border border-[rgba(168,85,247,0.3)] text-[#E9D5FF]">
        <span className="h-1.5 w-1.5 rounded-full bg-[#C084FC] animate-pulse" />
        RUNNING // PIPELINE ACTIVE
      </span>
    );
  };

  const isTerminal =
    ['completed', 'failed', 'cancelled'].includes(missionStatus) ||
    resultStatus?.ready === true ||
    ['verified', 'needs_revision', 'failed'].includes(resultStatus?.verification);
  const canCancel = !isTerminal && ['running', 'planning', 'queued', 'evaluating'].includes(missionStatus);

  const handleCancelClick = async () => {
    if (!missionId || isCancelling) return;
    setIsCancelling(true);
    setActionError(null);
    try {
      if (onCancelMission) {
        await onCancelMission(missionId);
      } else {
        await cancelMission(missionId, { reason: 'operator_abort' });
        if (onRefreshResult) await onRefreshResult();
      }
      setActionSuccess('Mission execution aborted by operator.');
      setTimeout(() => setActionSuccess(null), 3500);
    } catch (err) {
      setActionError(err.message || 'Failed to abort mission.');
    } finally {
      setIsCancelling(false);
    }
  };

  const handleRetryTaskClick = async (taskId) => {
    if (!missionId || !taskId || retryingTaskId) return;
    setRetryingTaskId(taskId);
    setActionError(null);
    try {
      if (onRetryTask) {
        await onRetryTask(missionId, taskId);
      } else {
        await retryTask(missionId, taskId);
        if (onRefreshResult) await onRefreshResult();
      }
      setActionSuccess('Task queued for retry.');
      setTimeout(() => setActionSuccess(null), 3500);
    } catch (err) {
      setActionError(err.message || 'Failed to retry task.');
    } finally {
      setRetryingTaskId(null);
    }
  };

  return (
    <motion.div
      key="mission-result"
      variants={fadeIn}
      initial="initial"
      animate="animate"
      exit="exit"
      className="flex-1 flex flex-col justify-between"
    >
      <div>
        {/* 1. Header Toolbar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 pb-3 border-b border-[rgba(168,85,247,0.14)]">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleCopyMissionId}
              title="Click to copy full Mission ID"
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono bg-[#0D091A] border border-[rgba(168,85,247,0.25)] text-[#C084FC] hover:bg-[#150F26] transition-colors cursor-pointer"
            >
              <span className="text-[#756B7D]">ID:</span>
              <span className="font-bold">{missionId ? missionId.slice(0, 10) + '...' : 'PENDING'}</span>
              {copiedId ? (
                <span className="text-[#39FF88] text-[9px]">COPIED</span>
              ) : (
                <svg className="w-2.5 h-2.5 text-[#756B7D]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              )}
            </button>
            <TechnicalLabel variant="primary" size="xs">
              ENCLAVE 01
            </TechnicalLabel>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {getStatusBadge()}
            {canCancel && (
              <button
                type="button"
                onClick={handleCancelClick}
                disabled={isCancelling}
                title="Abort mission execution"
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-mono font-bold uppercase bg-[rgba(239,68,68,0.12)] border border-[rgba(239,68,68,0.35)] text-[#EF4444] hover:bg-[rgba(239,68,68,0.22)] hover:border-[#EF4444] transition-colors cursor-pointer disabled:opacity-50"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-[#EF4444] animate-pulse" />
                {isCancelling ? 'ABORTING...' : 'ABORT MISSION'}
              </button>
            )}
            {isTerminal && onReset && (
              <button
                type="button"
                onClick={onReset}
                title="Create another mission"
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-mono font-bold bg-[#120B20] border border-[rgba(192,132,252,0.4)] text-[#E9D5FF] hover:text-white hover:border-[#C084FC] transition-colors cursor-pointer"
              >
                <span>+ NEW</span>
              </button>
            )}
          </div>
        </div>

        {/* Action Status Feedback */}
        {actionError && (
          <div className="rounded-lg bg-[rgba(239,68,68,0.08)] border border-[rgba(239,68,68,0.3)] p-2.5 mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-mono text-[#EF4444]">
              <span className="font-bold">OPERATOR ACTION ERROR:</span>
              <span>{actionError}</span>
            </div>
            <button
              type="button"
              onClick={() => setActionError(null)}
              className="text-[10px] font-mono text-[#EF4444] hover:underline cursor-pointer"
            >
              DISMISS
            </button>
          </div>
        )}
        {actionSuccess && (
          <div className="rounded-lg bg-[rgba(57,255,136,0.08)] border border-[rgba(57,255,136,0.3)] p-2.5 mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-mono text-[#39FF88]">
              <span className="font-bold">STATUS:</span>
              <span>{actionSuccess}</span>
            </div>
            <button
              type="button"
              onClick={() => setActionSuccess(null)}
              className="text-[10px] font-mono text-[#39FF88] hover:underline cursor-pointer"
            >
              DISMISS
            </button>
          </div>
        )}

        {/* Invariant Rejection / Failure Notice Banner */}
        {(resultStatus?.verification === 'failed' || missionStatus === 'failed') && (
          <div className="rounded-lg bg-[rgba(239,68,68,0.08)] border border-[rgba(239,68,68,0.3)] p-3 mb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="text-xs font-mono text-[#FCA5A5]">
              <span className="font-bold text-[#EF4444]">INVARIANT REJECTION:</span> A pipeline quality assertion flagged an issue. You can inspect the audit or retry tasks below.
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setActiveTab('audit')}
                className="px-2.5 py-1 rounded bg-[#180A0E] border border-[rgba(239,68,68,0.4)] text-[10px] font-mono text-[#FCA5A5] hover:text-white cursor-pointer"
              >
                VIEW AUDIT
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('tasks')}
                className="px-2.5 py-1 rounded bg-[#180A0E] border border-[rgba(239,68,68,0.4)] text-[10px] font-mono text-[#FCA5A5] hover:text-white cursor-pointer"
              >
                VIEW TASKS & RETRY
              </button>
            </div>
          </div>
        )}

        {/* 2. Directive Banner */}
        <div className="rounded-lg bg-[#050508] border border-[rgba(168,85,247,0.12)] p-3 mb-4">
          <div className="flex items-center justify-between mb-1 select-none">
            <div className="flex items-center gap-2">
              <span className="text-[#C084FC] font-mono text-xs font-bold">nx://objective &gt;</span>
              <span className="text-[10px] font-mono text-[#554C5C] uppercase">AUTHENTICATED DIRECTIVE</span>
            </div>
            {objective && (
              <span className="text-[9px] font-mono text-[#554C5C]">
                {objective.length} CHARS
              </span>
            )}
          </div>
          <p className="text-xs font-mono text-[#F5F1FA] leading-relaxed whitespace-pre-wrap">
            {objective}
          </p>
        </div>

        {/* 3. Metric HUD Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-4">
          {/* Tasks Metric */}
          <div className="p-3 rounded-lg bg-[#07050E] border border-[rgba(168,85,247,0.12)]">
            <div className="flex items-center justify-between text-[9px] font-mono text-[#756B7D] mb-1">
              <span>TASKS PIPELINE</span>
              <span>{taskProgressPercent}%</span>
            </div>
            <div className="text-sm font-mono font-bold text-[#F5F1FA] mb-1.5">
              {completedTasks} / {totalTasks} <span className="text-[10px] font-normal text-[#756B7D]">done</span>
            </div>
            <div className="w-full bg-[#110C1E] h-1 rounded-full overflow-hidden">
              <div
                className="bg-gradient-to-r from-[#A855F7] to-[#39FF88] h-full transition-all duration-500"
                style={{ width: `${taskProgressPercent}%` }}
              />
            </div>
          </div>

          {/* Evidence Metric */}
          <div className="p-3 rounded-lg bg-[#07050E] border border-[rgba(168,85,247,0.12)]">
            <span className="text-[9px] font-mono text-[#756B7D] block mb-1">EMPIRICAL EVIDENCE</span>
            <div className="text-sm font-mono font-bold text-[#38BDF8]">
              {evidence.length} <span className="text-[10px] font-normal text-[#756B7D]">nodes</span>
            </div>
            <span className="text-[9px] font-mono text-[#554C5C] block mt-1">
              {evidence.length > 0 ? 'RESEARCH VERIFIED' : 'NO NODES LOGGED'}
            </span>
          </div>

          {/* Deliverable Type Metric */}
          <div className="p-3 rounded-lg bg-[#07050E] border border-[rgba(168,85,247,0.12)]">
            <span className="text-[9px] font-mono text-[#756B7D] block mb-1">DELIVERABLE</span>
            <div className="text-sm font-mono font-bold text-[#C084FC] truncate">
              {artifact ? (artifact.artifactType || 'REPORT').toUpperCase() : 'SYNTHESIZING'}
            </div>
            <span className="text-[9px] font-mono text-[#554C5C] block mt-1">
              {artifact ? `BY ${(artifact.buildMethod || 'AI').toUpperCase()}` : 'BUILDER ACTIVE'}
            </span>
          </div>

          {/* QA Gate Metric */}
          <div className="p-3 rounded-lg bg-[#07050E] border border-[rgba(168,85,247,0.12)]">
            <span className="text-[9px] font-mono text-[#756B7D] block mb-1">QA GATE</span>
            <div className={`text-sm font-mono font-bold uppercase ${
              resultStatus?.qaVerdict === 'pass'
                ? 'text-[#39FF88]'
                : resultStatus?.qaVerdict === 'needs_revision'
                ? 'text-[#F59E0B]'
                : resultStatus?.qaVerdict === 'fail'
                ? 'text-[#EF4444]'
                : 'text-[#756B7D]'
            }`}>
              {resultStatus?.qaVerdict || 'PENDING'}
            </div>
            <span className="text-[9px] font-mono text-[#554C5C] block mt-1">
              {qa ? `${qa.checks?.length || 0} CHECKS RUN` : 'INSPECTION PENDING'}
            </span>
          </div>
        </div>

        {/* 4. Live Polling / Error Indicators */}
        {resultLoading && !missionResult && (
          <div className="rounded-lg bg-[#07050E] border border-[rgba(168,85,247,0.2)] p-3 mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-[#C084FC] animate-pulse" />
              <span className="text-xs font-mono text-[#E9D5FF]">
                POLLING BACKEND RESULT // SYNC ACTIVE (2.5s)
              </span>
            </div>
            <span className="text-[10px] font-mono text-[#756B7D]">ID: {missionId.slice(0, 8)}</span>
          </div>
        )}

        {resultError && (
          <div className="rounded-lg bg-[rgba(239,68,68,0.08)] border border-[rgba(239,68,68,0.3)] p-3 mb-4">
            <div className="flex items-center gap-2 text-[#EF4444] text-xs font-mono font-bold mb-1">
              <span>GATEWAY NOTICE:</span>
              <span>{resultError}</span>
            </div>
            <p className="text-[10px] font-mono text-[#F87171]">
              Authoritative result synchronization encountered an issue. Polling will resume automatically if transient.
            </p>
          </div>
        )}

        {/* 5. Navigation Tabs */}
        <div className="flex items-center gap-1 border-b border-[rgba(168,85,247,0.14)] mb-3 pb-1 overflow-x-auto scrollbar-none flex-nowrap">
          <button
            type="button"
            onClick={() => setActiveTab('deliverable')}
            className={`px-3 py-1.5 rounded-t text-xs font-mono font-bold uppercase transition-colors cursor-pointer shrink-0 ${
              activeTab === 'deliverable'
                ? 'bg-[#150D27] text-[#F5F1FA] border-b-2 border-b-[#A855F7]'
                : 'text-[#756B7D] hover:text-[#D8CFDE]'
            }`}
          >
            DELIVERABLE {artifact && '✓'}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('evidence')}
            className={`px-3 py-1.5 rounded-t text-xs font-mono font-bold uppercase transition-colors cursor-pointer shrink-0 ${
              activeTab === 'evidence'
                ? 'bg-[#150D27] text-[#F5F1FA] border-b-2 border-b-[#38BDF8]'
                : 'text-[#756B7D] hover:text-[#D8CFDE]'
            }`}
          >
            EVIDENCE ({evidence.length})
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('audit')}
            className={`px-3 py-1.5 rounded-t text-xs font-mono font-bold uppercase transition-colors cursor-pointer shrink-0 ${
              activeTab === 'audit'
                ? 'bg-[#150D27] text-[#F5F1FA] border-b-2 border-b-[#C084FC]'
                : 'text-[#756B7D] hover:text-[#D8CFDE]'
            }`}
          >
            AUDIT & QA
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('tasks')}
            className={`px-3 py-1.5 rounded-t text-xs font-mono font-bold uppercase transition-colors cursor-pointer shrink-0 ${
              activeTab === 'tasks'
                ? 'bg-[#150D27] text-[#F5F1FA] border-b-2 border-b-[#A855F7]'
                : 'text-[#756B7D] hover:text-[#D8CFDE]'
            }`}
          >
            TASKS ({completedTasks}/{totalTasks})
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('raw')}
            className={`px-3 py-1.5 rounded-t text-xs font-mono font-bold uppercase transition-colors cursor-pointer shrink-0 ${
              activeTab === 'raw'
                ? 'bg-[#150D27] text-[#F5F1FA] border-b-2 border-b-[#756B7D]'
                : 'text-[#756B7D] hover:text-[#D8CFDE]'
            }`}
          >
            RAW JSON
          </button>
        </div>

        {/* 6. Active Tab Content Panels */}
        <div className="min-h-[240px]">
          {activeTab === 'deliverable' && (
            <ArtifactViewer artifact={artifact} />
          )}

          {activeTab === 'evidence' && (
            <EvidenceExplorer evidence={evidence} />
          )}

          {activeTab === 'audit' && (
            <AuditInspector
              qa={qa}
              critique={critique}
              analysis={analysis}
              resultStatus={resultStatus}
            />
          )}

          {activeTab === 'tasks' && (
            <div className="space-y-2 my-2">
              <div className="text-[10px] font-mono text-[#756B7D] uppercase tracking-wider mb-2">
                TASK EXECUTION GRAPH ({tasks.length} NODES)
              </div>
              {tasks.length === 0 ? (
                <div className="p-4 rounded-lg bg-[#07050E] border border-[rgba(168,85,247,0.1)] text-center text-xs font-mono text-[#554C5C]">
                  NO TASKS ENQUEUED
                </div>
              ) : (
                tasks.map((task, idx) => (
                  <div
                    key={task.id || idx}
                    className="p-3 rounded-lg bg-[#07060B] border border-[rgba(168,85,247,0.1)] flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-mono font-bold text-[#A855F7]">
                        0{task.order ?? idx + 1}
                      </span>
                      <div>
                        <div className="text-xs font-mono font-bold text-[#F5F1FA]">
                          {task.title}
                        </div>
                        {task.description && (
                          <p className="text-[11px] font-mono text-[#756B7D] line-clamp-1">
                            {task.description}
                          </p>
                        )}
                        {task.error && (
                          <div className="mt-1 text-[10px] font-mono text-[#FCA5A5] bg-[rgba(239,68,68,0.06)] px-2 py-1 rounded border border-[rgba(239,68,68,0.2)]">
                            <span className="font-semibold text-[#EF4444]">ERROR:</span> {task.error}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono text-[#554C5C]">
                        {task.agentId || 'AGENT'}
                      </span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${
                        task.status === 'completed'
                          ? 'bg-[rgba(57,255,136,0.1)] text-[#39FF88] border border-[rgba(57,255,136,0.3)]'
                          : task.status === 'running'
                          ? 'bg-[rgba(192,132,252,0.1)] text-[#C084FC] border border-[rgba(192,132,252,0.3)] animate-pulse'
                          : task.status === 'failed'
                          ? 'bg-[rgba(239,68,68,0.1)] text-[#EF4444] border border-[rgba(239,68,68,0.3)]'
                          : 'bg-[#0A0712] text-[#756B7D] border border-[rgba(168,85,247,0.08)]'
                      }`}>
                        {task.status}
                      </span>
                      {task.status === 'failed' && missionStatus !== 'cancelled' && (
                        <button
                          type="button"
                          onClick={() => handleRetryTaskClick(task.id || task._id)}
                          disabled={retryingTaskId === (task.id || task._id)}
                          title="Retry failed task"
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-[rgba(168,85,247,0.15)] border border-[rgba(168,85,247,0.35)] text-[#C084FC] hover:bg-[rgba(168,85,247,0.25)] hover:text-[#F5F1FA] transition-colors cursor-pointer disabled:opacity-50"
                        >
                          <svg className={`w-2.5 h-2.5 ${retryingTaskId === (task.id || task._id) ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                          {retryingTaskId === (task.id || task._id) ? 'RETRYING...' : 'RETRY'}
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === 'raw' && (
            <div className="space-y-2 my-2">
              <div className="flex items-center justify-between pb-1">
                <span className="text-[10px] font-mono text-[#756B7D] uppercase">
                  SANITIZED AUTHORITATIVE RESULT PAYLOAD
                </span>
                <button
                  type="button"
                  onClick={handleCopyRawJson}
                  className="px-2 py-1 rounded bg-[#0D091A] border border-[rgba(168,85,247,0.25)] text-[10px] font-mono text-[#C084FC] hover:bg-[#150F26] cursor-pointer"
                >
                  {copiedJson ? 'COPIED JSON' : 'COPY JSON'}
                </button>
              </div>
              <pre className="p-3 rounded-lg bg-[#030206] border border-[rgba(168,85,247,0.12)] text-[11px] font-mono text-[#B8ADBF] overflow-x-auto max-h-[380px] scrollbar-thin">
                {JSON.stringify(missionResult, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>

      {/* 7. Console Footer Toolbar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pt-4 mt-4 border-t border-[rgba(168,85,247,0.12)]">
        <div className="flex items-center gap-2 text-[10px] font-mono text-[#756B7D]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#39FF88]" />
          <span>AUTHORITATIVE SOURCE // BACKEND RESULT API (PORT 5000)</span>
        </div>

        <div className="flex items-center gap-3">
          <motion.button
            type="button"
            onClick={onReset}
            whileHover={{ scale: 1.015 }}
            whileTap={{ scale: 0.985 }}
            transition={springs.tactile}
            className="inline-flex items-center gap-2 rounded-lg bg-[#090710] border border-[rgba(168,85,247,0.3)] px-4 py-2 text-xs font-mono font-bold text-[#E9D5FF] hover:bg-[#120B20] hover:border-[rgba(192,132,252,0.5)] hover:text-[#F5F1FA] transition-colors cursor-pointer"
          >
            <span>+ CREATE ANOTHER MISSION</span>
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
}
