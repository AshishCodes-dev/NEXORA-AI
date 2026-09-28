/**
 * NEXORA Autonomous Execution Event Model
 * UI-safe event schemas, category definitions, and state mappings.
 *
 * IMPORTANT:
 * The actual autonomous AI orchestrator does NOT exist yet.
 * This file defines the contract for frontend execution stream ingestion.
 * DO NOT include fabricated research facts, fake citations, fake external sources, or fake URLs.
 */

export const EXECUTION_EVENT_TYPES = {
  MISSION_ACCEPTED: 'MISSION_ACCEPTED',
  PLANNING_STARTED: 'PLANNING_STARTED',
  DIRECTIVE_DECOMPOSED: 'DIRECTIVE_DECOMPOSED',
  RESEARCH_STARTED: 'RESEARCH_STARTED',
  BROWSER_ACTIVE: 'BROWSER_ACTIVE',
  ANALYSIS_STARTED: 'ANALYSIS_STARTED',
  VERIFICATION_STARTED: 'VERIFICATION_STARTED',
  BUILD_STARTED: 'BUILD_STARTED',
  QA_STARTED: 'QA_STARTED',
  MISSION_COMPLETE: 'MISSION_COMPLETE',
};

export const EVIDENCE_STATUS = {
  WAITING: 'WAITING',
  COLLECTING: 'COLLECTING',
  READY: 'READY',
  VERIFIED: 'VERIFIED',
};

export const EVIDENCE_CATEGORIES = {
  RESEARCH: 'RESEARCH',
  BROWSER: 'BROWSER',
  ANALYST: 'ANALYST',
  CRITIC: 'CRITIC',
};

/**
 * Initial evidence state template for UI initialization.
 * Pure structured placeholders. Zero fake research or citations.
 */
export const INITIAL_EVIDENCE_MAP = {
  [EVIDENCE_CATEGORIES.RESEARCH]: {
    id: 'ev-research',
    category: EVIDENCE_CATEGORIES.RESEARCH,
    label: 'RESEARCH REPOSITORY',
    status: EVIDENCE_STATUS.WAITING,
    placeholder: 'Awaiting verified sources... Indexing semantic vectors.',
    agentId: 'MOD.01',
    agentName: 'Research Agent',
    lastUpdated: null,
  },
  [EVIDENCE_CATEGORIES.BROWSER]: {
    id: 'ev-browser',
    category: EVIDENCE_CATEGORIES.BROWSER,
    label: 'BROWSER DISCOVERY',
    status: EVIDENCE_STATUS.WAITING,
    placeholder: 'Awaiting browser discovery... Headless runtime on standby.',
    agentId: 'MOD.02',
    agentName: 'Browser Agent',
    lastUpdated: null,
  },
  [EVIDENCE_CATEGORIES.ANALYST]: {
    id: 'ev-analyst',
    category: EVIDENCE_CATEGORIES.ANALYST,
    label: 'SYNTHESIS MATRIX',
    status: EVIDENCE_STATUS.WAITING,
    placeholder: 'Awaiting synthesis output... Reasoning pipeline queued.',
    agentId: 'MOD.03',
    agentName: 'Analyst Agent',
    lastUpdated: null,
  },
  [EVIDENCE_CATEGORIES.CRITIC]: {
    id: 'ev-critic',
    category: EVIDENCE_CATEGORIES.CRITIC,
    label: 'LOGIC & ASSERTIONS',
    status: EVIDENCE_STATUS.WAITING,
    placeholder: 'Awaiting verification result... Assertion suite pending.',
    agentId: 'MOD.04',
    agentName: 'Critic Agent',
    lastUpdated: null,
  },
};

/**
 * Deterministic Demo Pipeline Event Definitions
 * Calibrated sequence simulating an end-to-end autonomous run.
 * Contains only internal technical pipeline descriptors.
 */
export const DEMO_EVENT_SEQUENCE = [
  {
    type: EXECUTION_EVENT_TYPES.MISSION_ACCEPTED,
    agentId: 'CORE',
    agentTag: 'CORE',
    title: 'MISSION DIRECTIVE ENQUEUED',
    description: 'Directive packet verified. Initializing neural execution pipeline.',
    systemState: 'PLANNING',
    activeAgentId: 'MOD.03', // Planner / Analyst
    secondaryAgentId: null,
    evidenceUpdate: null,
    delayMs: 1600,
  },
  {
    type: EXECUTION_EVENT_TYPES.PLANNING_STARTED,
    agentId: 'MOD.03',
    agentTag: 'PLANNER',
    title: 'TASK DECOMPOSITION ENGAGED',
    description: 'Decomposing operational directive into dependency-ordered DAG.',
    systemState: 'PLANNING',
    activeAgentId: 'MOD.03',
    secondaryAgentId: null,
    evidenceUpdate: {
      category: EVIDENCE_CATEGORIES.ANALYST,
      status: EVIDENCE_STATUS.COLLECTING,
      placeholder: 'Synthesizing task topology and dependency nodes...',
    },
    delayMs: 2200,
  },
  {
    type: EXECUTION_EVENT_TYPES.DIRECTIVE_DECOMPOSED,
    agentId: 'MOD.03',
    agentTag: 'PLANNER',
    title: 'EXECUTION GRAPH LOCKED',
    description: 'Task graph compiled (6 phases). Dispatching sub-tasks to cluster.',
    systemState: 'PLANNING',
    activeAgentId: 'MOD.03',
    secondaryAgentId: null,
    evidenceUpdate: {
      category: EVIDENCE_CATEGORIES.ANALYST,
      status: EVIDENCE_STATUS.READY,
      placeholder: 'Execution graph locked: 6 operational stages verified.',
    },
    delayMs: 2000,
  },
  {
    type: EXECUTION_EVENT_TYPES.RESEARCH_STARTED,
    agentId: 'MOD.01',
    agentTag: 'RESEARCH',
    title: 'RESEARCH CHANNEL OPENED',
    description: 'Semantic vector retrieval and deep intelligence indexing active.',
    systemState: 'RESEARCHING',
    activeAgentId: 'MOD.01',
    secondaryAgentId: 'MOD.02',
    evidenceUpdate: {
      category: EVIDENCE_CATEGORIES.RESEARCH,
      status: EVIDENCE_STATUS.COLLECTING,
      placeholder: 'Indexing local vector knowledge nodes and telemetry...',
    },
    delayMs: 2400,
  },
  {
    type: EXECUTION_EVENT_TYPES.BROWSER_ACTIVE,
    agentId: 'MOD.02',
    agentTag: 'BROWSER',
    title: 'TELEMETRY GATEWAY ACTIVE',
    description: 'Headless sandbox operational. DOM telemetry linked.',
    systemState: 'RESEARCHING',
    activeAgentId: 'MOD.02',
    secondaryAgentId: 'MOD.01',
    evidenceUpdate: {
      category: EVIDENCE_CATEGORIES.BROWSER,
      status: EVIDENCE_STATUS.COLLECTING,
      placeholder: 'Headless session linked. Collecting interface telemetry...',
    },
    delayMs: 2200,
  },
  {
    type: EXECUTION_EVENT_TYPES.ANALYSIS_STARTED,
    agentId: 'MOD.03',
    agentTag: 'ANALYST',
    title: 'SYNTHESIS PIPELINE ENGAGED',
    description: 'Compacting intelligence chunks and aligning operational context.',
    systemState: 'ANALYZING',
    activeAgentId: 'MOD.03',
    secondaryAgentId: null,
    evidenceUpdate: {
      category: EVIDENCE_CATEGORIES.RESEARCH,
      status: EVIDENCE_STATUS.READY,
      placeholder: 'Semantic vector retrieval indexed and ready for synthesis.',
    },
    delayMs: 2400,
  },
  {
    type: EXECUTION_EVENT_TYPES.VERIFICATION_STARTED,
    agentId: 'MOD.04',
    agentTag: 'CRITIC',
    title: 'ASSERTION AUDIT ACTIVE',
    description: 'Auditing logic constraints, boundary conditions, and safety rules.',
    systemState: 'VERIFYING',
    activeAgentId: 'MOD.04',
    secondaryAgentId: null,
    evidenceUpdate: {
      category: EVIDENCE_CATEGORIES.CRITIC,
      status: EVIDENCE_STATUS.COLLECTING,
      placeholder: 'Evaluating logical invariants and safety bounds...',
    },
    delayMs: 2200,
  },
  {
    type: EXECUTION_EVENT_TYPES.BUILD_STARTED,
    agentId: 'MOD.05',
    agentTag: 'BUILDER',
    title: 'ARTIFACT SYNTHESIS ACTIVE',
    description: 'Synthesizing target code, scaffolds, and sandbox targets.',
    systemState: 'BUILDING',
    activeAgentId: 'MOD.05',
    secondaryAgentId: null,
    evidenceUpdate: {
      category: EVIDENCE_CATEGORIES.BROWSER,
      status: EVIDENCE_STATUS.READY,
      placeholder: 'Target DOM and workspace configuration verified.',
    },
    delayMs: 2400,
  },
  {
    type: EXECUTION_EVENT_TYPES.QA_STARTED,
    agentId: 'MOD.06',
    agentTag: 'QA',
    title: 'VALIDATION HARNESS RUNNING',
    description: 'Running assertion test suite and automated output validation.',
    systemState: 'QA',
    activeAgentId: 'MOD.06',
    secondaryAgentId: null,
    evidenceUpdate: {
      category: EVIDENCE_CATEGORIES.CRITIC,
      status: EVIDENCE_STATUS.VERIFIED,
      placeholder: 'All constraint assertions passed. Invariant score: 100%.',
    },
    delayMs: 2200,
  },
  {
    type: EXECUTION_EVENT_TYPES.MISSION_COMPLETE,
    agentId: 'CORE',
    agentTag: 'CORE',
    title: 'MISSION EXECUTION COMPLETE',
    description: 'All stages verified. Autonomous execution pipeline locked.',
    systemState: 'COMPLETE',
    activeAgentId: null,
    secondaryAgentId: null,
    evidenceUpdate: null,
    delayMs: 0,
  },
];
