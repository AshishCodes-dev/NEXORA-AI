import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence, MotionConfig } from 'motion/react';
import Sidebar from './components/Sidebar';
import Topbar from './components/Topbar';
import NexoraCore from './components/NexoraCore';
import TechnicalLabel from './components/TechnicalLabel';
import GlassPanel from './components/GlassPanel';
import MotionPage from './components/MotionPage';
import NexoraBootSequence from './components/NexoraBootSequence';
import AgentModuleCard from './components/AgentModuleCard';
import MissionComposer from './components/MissionComposer';
import ExecutionFeed from './components/ExecutionFeed';
import EvidenceStream from './components/EvidenceStream';
import demoExecutionEngine from './services/demoExecutionEngine';
import { getMissionResult, MissionResultError } from './services/missionResultService';
import { INITIAL_EVIDENCE_MAP } from './constants/executionEvents';
import { MISSION_STATES, STATE_CONFIG, STATE_ORDER } from './constants/missionStates';
import { staggerContainer, staggerItem, fadeIn } from './motion/variants';
import { springs } from './motion/transitions';
import { RouterProvider, useRouter } from './router/RouterContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';

function Dashboard() {
  const { isAuthenticated } = useAuth();
  const { navigate } = useRouter();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [missionDirective, setMissionDirective] = useState(() => {
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        const pending = window.sessionStorage.getItem('nexora_pending_directive');
        if (pending) {
          window.sessionStorage.removeItem('nexora_pending_directive');
          return pending;
        }
      }
    } catch {
      // Ignore storage exception
    }
    return '';
  });

  // Autonomous System State Model (Task 1 & Task 4)
  const [systemState, setSystemState] = useState(MISSION_STATES.IDLE);
  const demoTimerRef = useRef(null);
  const currentConfig = STATE_CONFIG[systemState] || STATE_CONFIG[MISSION_STATES.IDLE];
  const coreState = currentConfig.coreState;

  // Cleanup demo timer and simulation engine on unmount
  useEffect(() => {
    return () => {
      demoExecutionEngine.stop();
      if (demoTimerRef.current) clearTimeout(demoTimerRef.current);
      if (pollingTimerRef.current) clearTimeout(pollingTimerRef.current);
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, []);

  // Session-Aware Boot Sequence State (Runs once per browser session)
  const [isBooting, setIsBooting] = useState(() => {
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        return window.sessionStorage.getItem('nexora_boot_complete') !== 'true';
      }
    } catch {
      // In case of restricted iframe or strict cookie policy
    }
    return true;
  });

  const handleBootComplete = () => {
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        window.sessionStorage.setItem('nexora_boot_complete', 'true');
      }
    } catch {
      // Ignore storage exception
    }
    setIsBooting(false);
  };

  // Mission Submission & Lifecycle State
  const [submissionState, setSubmissionState] = useState('idle'); // 'idle' | 'processing' | 'success' | 'error'
  const [submissionError, setSubmissionError] = useState(null);
  const [createdMission, setCreatedMission] = useState(null);

  // Step 8B.1: Authoritative Backend Mission Result State
  const [currentMissionId, setCurrentMissionId] = useState(null);
  const [missionResult, setMissionResult] = useState(null);
  const [resultLoading, setResultLoading] = useState(false);
  const [resultError, setResultError] = useState(null);
  const [isPolling, setIsPolling] = useState(false);

  const pollingTimerRef = useRef(null);
  const isFetchingRef = useRef(false);
  const activeMissionIdRef = useRef(null);
  const abortControllerRef = useRef(null);

  // Synchronize active mission ID ref
  useEffect(() => {
    activeMissionIdRef.current = currentMissionId;
  }, [currentMissionId]);

  // Auth cleanup: stop polling and clear mission state on logout
  useEffect(() => {
    if (!isAuthenticated) {
      if (pollingTimerRef.current) clearTimeout(pollingTimerRef.current);
      if (abortControllerRef.current) abortControllerRef.current.abort();
      isFetchingRef.current = false;
      activeMissionIdRef.current = null;
      setIsPolling(false);
      setResultLoading(false);
      setCurrentMissionId(null);
      setMissionResult(null);
      setResultError(null);
      demoExecutionEngine.stop();
    }
  }, [isAuthenticated]);

  // Authoritative Mission Result Polling Effect (Step 8B.1)
  useEffect(() => {
    if (!currentMissionId || !isPolling || !isAuthenticated) {
      return;
    }

    let isMounted = true;

    const poll = async () => {
      // Guard against overlapping poll requests
      if (isFetchingRef.current) return;
      if (!isMounted || activeMissionIdRef.current !== currentMissionId) return;

      isFetchingRef.current = true;
      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const result = await getMissionResult(currentMissionId, {
          signal: controller.signal,
        });

        // Guard against race condition if mission ID changed while in flight
        if (!isMounted || activeMissionIdRef.current !== currentMissionId) {
          return;
        }

        setMissionResult(result);
        setResultError(null);
        setResultLoading(false);

        // Update active agent based on real running tasks
        if (result?.tasks && Array.isArray(result.tasks)) {
          const runningTask = result.tasks.find(t => t.status === 'running');
          if (runningTask) {
            const agentKey = (runningTask.agentId || '').toLowerCase();
            const textToMatch = `${runningTask.title || ''} ${runningTask.description || ''}`.toLowerCase();
            let matchedState = null;

            if (agentKey === 'qa' || /\b(qa|test)\b/.test(textToMatch)) {
              matchedState = MISSION_STATES.QA;
            } else if (agentKey === 'builder' || /\b(builder|output|artifact|build|assemble)\b/.test(textToMatch)) {
              matchedState = MISSION_STATES.BUILDING;
            } else if (agentKey === 'critic' || /\b(critic|audit|verify|validation)\b/.test(textToMatch)) {
              matchedState = MISSION_STATES.VERIFYING;
            } else if (agentKey === 'research' || /\b(research|gather|collect|search)\b/.test(textToMatch)) {
              matchedState = MISSION_STATES.RESEARCHING;
            } else if (agentKey === 'analyst' || /\b(analyst|analyze|analysis)\b/.test(textToMatch)) {
              matchedState = MISSION_STATES.ANALYZING;
            }

            if (matchedState) {
              setSystemState(matchedState);
            }
          }
        }

        const missionStatus = result?.mission?.status;
        const resultStatus = result?.resultStatus;
        const verificationStatus = result?.status;
        const isReady = resultStatus?.ready === true;
        const isTerminal =
          missionStatus === 'completed' ||
          missionStatus === 'failed' ||
          isReady ||
          ['verified', 'needs_revision', 'failed'].includes(verificationStatus);

        if (isTerminal) {
          setIsPolling(false);
          demoExecutionEngine.stop();
          if (missionStatus === 'completed' || isReady || ['verified', 'needs_revision'].includes(verificationStatus)) {
            setSystemState(MISSION_STATES.COMPLETE);
          } else if (missionStatus === 'failed' || verificationStatus === 'failed') {
            setSystemState(MISSION_STATES.IDLE);
          }
          return;
        }

        // Schedule next poll interval (2.5s)
        if (isMounted && activeMissionIdRef.current === currentMissionId) {
          pollingTimerRef.current = setTimeout(poll, 2500);
        }
      } catch (err) {
        if (!isMounted || activeMissionIdRef.current !== currentMissionId) {
          return;
        }

        if (err.name === 'AbortError') {
          return;
        }

        const errorMessage = err.message || 'Failed to fetch mission result';
        setResultError(errorMessage);
        setResultLoading(false);

        // Stop polling on terminal auth or not-found errors
        if (err.statusCode === 401 || err.statusCode === 404) {
          setIsPolling(false);
          return;
        }

        // For transient errors, retry after interval
        if (isMounted && activeMissionIdRef.current === currentMissionId) {
          pollingTimerRef.current = setTimeout(poll, 2500);
        }
      } finally {
        isFetchingRef.current = false;
      }
    };

    poll();

    return () => {
      isMounted = false;
      if (pollingTimerRef.current) clearTimeout(pollingTimerRef.current);
      if (abortControllerRef.current) abortControllerRef.current.abort();
      isFetchingRef.current = false;
    };
  }, [currentMissionId, isPolling, isAuthenticated]);

  // Execution Telemetry & Evidence Streams (Step 5)
  const [executionEvents, setExecutionEvents] = useState([]);
  const [evidenceMap, setEvidenceMap] = useState(INITIAL_EVIDENCE_MAP);
  const [isSimulating, setIsSimulating] = useState(false);
  const [activeAgentId, setActiveAgentId] = useState(null);
  const [activeSecondaryAgentId, setActiveSecondaryAgentId] = useState(null);

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
      } catch (err) {
        setBackendHealth({ status: 'offline', message: err.message });
        setBackendConnected(false);
      } finally {
        setBackendLoading(false);
      }
    };

    checkBackend();
  }, []);

  // Submit Mission to Backend API (POST /api/missions)
  const handleRunMission = async (e) => {
    if (e) e.preventDefault();

    // Prevent duplicate submission while already processing or simulating (Task 13)
    if (submissionState === 'processing' || isSimulating) return;

    const trimmed = missionDirective.trim();

    // Validation: reject empty or whitespace-only directive
    if (!trimmed) {
      setSubmissionError('Mission objective cannot be empty. Please specify an operational directive.');
      setSubmissionState('error');
      return;
    }

    // Step 6B Auth Gate: Block unauthenticated operators from dispatching missions
    if (!isAuthenticated) {
      setSubmissionError('AUTHENTICATION_REQUIRED: Operator identity unverified. Directives require active authentication.');
      setSubmissionState('error');
      try {
        if (typeof window !== 'undefined' && window.sessionStorage) {
          window.sessionStorage.setItem('nexora_pending_directive', trimmed);
        }
      } catch {
        // Ignore storage exception
      }
      navigate('/login');
      return;
    }

    setSubmissionState('processing');
    setSubmissionError(null);
    setSystemState(MISSION_STATES.PLANNING);

    try {
      const response = await fetch('http://localhost:5000/api/missions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ objective: trimmed }),
      });

      let data;
      try {
        data = await response.json();
      } catch {
        throw new Error(`Server returned unexpected non-JSON response (HTTP ${response.status})`);
      }

      if (!response.ok || !data || !data.success || !data.mission || typeof data.mission !== 'object' || !data.mission.id) {
        const message =
          data?.message ||
          data?.error ||
          (response.status === 401
            ? 'Authentication required. Please log in.'
            : `Server responded with status ${response.status}`);
        throw new Error(message);
      }

      setCreatedMission(data.mission);
      setCurrentMissionId(data.mission.id);
      activeMissionIdRef.current = data.mission.id;
      setMissionResult(null);
      setResultError(null);
      setResultLoading(true);
      setIsPolling(true);
      setSubmissionState('success');
      setIsSimulating(true);

      // Reset previous telemetry logs before starting fresh run
      setExecutionEvents([]);
      setEvidenceMap(INITIAL_EVIDENCE_MAP);

      // Start the deterministic demo execution sequence (Task 2, 7 & 11)
      demoExecutionEngine.start(data.mission, {
        onEvent: (event) => {
          setExecutionEvents((prev) => [...prev, event]);
        },
        onStateChange: (newState, primaryAgent, secondaryAgent) => {
          setSystemState(newState);
          setActiveAgentId(primaryAgent);
          setActiveSecondaryAgentId(secondaryAgent);
        },
        onEvidenceUpdate: (update) => {
          setEvidenceMap((prev) => ({
            ...prev,
            [update.category]: {
              ...prev[update.category],
              status: update.status,
              placeholder: update.placeholder,
              timeString: update.timeString,
              lastUpdated: update.timestamp,
            },
          }));
        },
        onComplete: () => {
          setIsSimulating(false);
          setActiveAgentId(null);
          setActiveSecondaryAgentId(null);
        },
      });
    } catch (err) {
      const errorMessage =
        err.message === 'Failed to fetch' || err.name === 'TypeError'
          ? 'NEXORA backend unavailable on port 5000. Ensure server is running.'
          : err.message || 'Mission initialization failed. Please retry.';
      setSubmissionError(errorMessage);
      setSubmissionState('error');
      setSystemState(MISSION_STATES.IDLE);
      setIsSimulating(false);
      setIsPolling(false);
      setResultLoading(false);
      demoExecutionEngine.stop();
    }
  };

  // Reset Composer for New Mission (Task 12)
  const handleResetMission = () => {
    demoExecutionEngine.stop();
    if (demoTimerRef.current) clearTimeout(demoTimerRef.current);
    if (pollingTimerRef.current) clearTimeout(pollingTimerRef.current);
    if (abortControllerRef.current) abortControllerRef.current.abort();
    isFetchingRef.current = false;
    activeMissionIdRef.current = null;

    setCurrentMissionId(null);
    setMissionResult(null);
    setResultLoading(false);
    setResultError(null);
    setIsPolling(false);

    setSubmissionState('idle');
    setMissionDirective('');
    setCreatedMission(null);
    setSubmissionError(null);
    setSystemState(MISSION_STATES.IDLE);
    setExecutionEvents([]);
    setEvidenceMap(INITIAL_EVIDENCE_MAP);
    setIsSimulating(false);
    setActiveAgentId(null);
    setActiveSecondaryAgentId(null);
  };

  // System Telemetry Metrics (Derived from systemState, Task 5)
  const systemTelemetry = [
    {
      label: 'MISSION ENGINE',
      value: currentConfig.engineStatus,
      tag: createdMission ? 'DISPATCHED' : 'ENCLAVE 01',
      color: currentConfig.engineStatus === 'ACTIVE' ? 'text-[#39FF88]' : 'text-[#E9D5FF]',
      dot: currentConfig.engineStatus === 'ACTIVE' ? 'bg-[#39FF88]' : 'bg-[#A855F7]',
      isSuccess: currentConfig.engineStatus === 'ACTIVE',
    },
    {
      label: 'ACTIVE AGENT',
      value: currentConfig.activeAgentName,
      tag: currentConfig.activeAgentId ? currentConfig.activeAgentId : 'CLUSTER ONLINE',
      color: currentConfig.activeAgentId ? 'text-[#C084FC]' : 'text-[#756B7D]',
      dot: currentConfig.activeAgentId ? 'bg-[#C084FC]' : 'bg-[#554C5C]',
      isSuccess: !!currentConfig.activeAgentId,
    },
    {
      label: 'TASK QUEUE',
      value: currentConfig.taskQueue,
      tag: `STATE: ${currentConfig.label}`,
      color: currentConfig.processing === 'YES' ? 'text-[#F5F1FA]' : 'text-[#756B7D]',
      dot: currentConfig.processing === 'YES' ? 'bg-[#A855F7]' : 'bg-[#554C5C]',
      isSuccess: currentConfig.processing === 'YES',
    },
    {
      label: 'PROCESSING',
      value: currentConfig.processing,
      tag: backendConnected ? 'LINKED // PORT 5000' : 'STANDBY // LOCAL',
      color: currentConfig.processing === 'YES' ? 'text-[#39FF88]' : 'text-[#B8ADBF]',
      dot: currentConfig.processing === 'YES' ? 'bg-[#39FF88]' : 'bg-[#6D28D9]',
      isSuccess: currentConfig.processing === 'YES',
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
      activeActivity: 'Retrieving semantic intelligence vectors',
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
      activeActivity: 'Exploring web and DOM telemetry endpoints',
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
      activeActivity: 'Synthesizing reasoning & decomposing task graph',
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
      activeActivity: 'Auditing logic constraints & safety assertions',
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
      activeActivity: 'Synthesizing code artifacts and sandbox targets',
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
      activeActivity: 'Running test harness & assertion validations',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6a7.5 7.5 0 107.5 7.5h-7.5V6z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 10.5H21A7.5 7.5 0 0013.5 3v7.5z" />
        </svg>
      ),
    },
  ];

  return (
    <MotionConfig reducedMotion="user">
      {/* Full-screen Cinematic Boot Sequence (Runs once per browser session) */}
      <AnimatePresence>
        {isBooting && (
          <NexoraBootSequence key="nexora-boot" onComplete={handleBootComplete} />
        )}
      </AnimatePresence>

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

          <MotionPage className="flex-1 p-4 sm:p-6 lg:p-8 flex flex-col gap-6 max-w-7xl w-full mx-auto">
            {/* ============================================================ */}
            {/* 4. SYSTEM TELEMETRY HUD STRIP                               */}
            {/* ============================================================ */}
            <motion.div
              variants={staggerContainer(0.06, 0.04)}
              initial="initial"
              animate="animate"
              className="grid grid-cols-2 md:grid-cols-4 gap-3 w-full"
            >
              {systemTelemetry.map((metric) => (
                <motion.div key={metric.label} variants={staggerItem}>
                  <GlassPanel className="p-3 sm:p-3.5 h-full">
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
                </motion.div>
              ))}
            </motion.div>

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
                  <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 whitespace-nowrap">
                    <TechnicalLabel variant={currentConfig.processing === 'YES' ? 'primary' : 'default'} size="xs">
                      {`STATE // ${currentConfig.label}`}
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

                {/* State Previewer Switcher (Task 1 & Task 14) */}
                <div className="mt-4 w-full px-2">
                  <div className="text-[8.5px] font-mono text-[#554C5C] text-center mb-1.5 uppercase tracking-wider">
                    AUTONOMOUS STATE PREVIEWER
                  </div>
                  <div className="flex flex-wrap items-center justify-center gap-1">
                    {STATE_ORDER.map((st) => (
                      <motion.button
                        key={st}
                        type="button"
                        whileHover={{ scale: 1.04 }}
                        whileTap={{ scale: 0.96 }}
                        transition={springs.tactile}
                        onClick={() => {
                          if (demoTimerRef.current) clearTimeout(demoTimerRef.current);
                          setSystemState(st);
                        }}
                        className={`text-[8.5px] font-mono uppercase px-2 py-0.5 rounded border transition-colors cursor-pointer ${
                          systemState === st
                            ? 'border-[rgba(192,132,252,0.5)] text-[#E9D5FF] bg-[#120B20] shadow-[0_0_8px_rgba(168,85,247,0.22)]'
                            : 'border-[rgba(168,85,247,0.08)] text-[#554C5C] hover:text-[#B8ADBF] bg-[#020203]'
                        }`}
                      >
                        {st}
                      </motion.button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Right Column: Mission Command Center / Directive Composer */}
              <MissionComposer
                missionDirective={missionDirective}
                setMissionDirective={setMissionDirective}
                submissionState={submissionState}
                submissionError={submissionError}
                setSubmissionError={setSubmissionError}
                createdMission={createdMission}
                systemState={systemState}
                currentConfig={currentConfig}
                missionResult={missionResult}
                resultLoading={resultLoading}
                resultError={resultError}
                onSubmit={handleRunMission}
                onReset={handleResetMission}
              />
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

              {/* 6 Connected Modules Grid (Task 3, 4, 8 & 10) */}
              <motion.div
                variants={staggerContainer(0.05, 0.08)}
                initial="initial"
                animate="animate"
                className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3"
              >
                {agentModules.map((agent) => {
                  const isAgentActive = activeAgentId
                    ? activeAgentId === agent.id
                    : currentConfig.activeAgentId === agent.id;
                  const isAgentSecondary = activeSecondaryAgentId
                    ? activeSecondaryAgentId === agent.id
                    : currentConfig.secondaryAgentId === agent.id;

                  return (
                    <AgentModuleCard
                      key={agent.id}
                      agent={agent}
                      isActive={isAgentActive}
                      isSecondary={isAgentSecondary}
                      activeStateLabel={isAgentActive ? currentConfig.description : ''}
                    />
                  );
                })}
              </motion.div>
            </div>

            {/* ============================================================ */}
            {/* 6. REAL-TIME EXECUTION FEED & EVIDENCE STREAM FOUNDATION     */}
            {/* ============================================================ */}
            <div className="w-full">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                {/* Left Column: Mission Execution Feed (7 cols) */}
                <div className="lg:col-span-7">
                  <ExecutionFeed
                    events={executionEvents}
                    isSimulating={isSimulating}
                    isComplete={systemState === MISSION_STATES.COMPLETE}
                  />
                </div>

                {/* Right Column: Evidence Stream (5 cols) */}
                <div className="lg:col-span-5">
                  <EvidenceStream
                    evidenceMap={evidenceMap}
                  />
                </div>
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
          </MotionPage>
        </div>
      </div>
    </MotionConfig>
  );
}

/**
 * MainRouter
 * Resolves current client path to designated NEXORA view:
 * - /login -> LoginPage
 * - /signup -> SignupPage
 * - default -> Autonomous Mission Control Dashboard
 */
function MainRouter() {
  const { currentPath } = useRouter();
  const normalized = (currentPath || '/').toLowerCase().replace(/\/+$/, '') || '/';

  if (normalized === '/login') {
    return <LoginPage />;
  }

  if (normalized === '/signup') {
    return <SignupPage />;
  }

  return <Dashboard />;
}

export default function App() {
  return (
    <RouterProvider>
      <AuthProvider>
        <MainRouter />
      </AuthProvider>
    </RouterProvider>
  );
}

