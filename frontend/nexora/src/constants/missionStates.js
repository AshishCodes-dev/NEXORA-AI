/**
 * NEXORA Mission & Autonomous System State Model
 * Centralized, isolated source of truth for workspace mission states.
 */

export const MISSION_STATES = {
  IDLE: 'IDLE',
  PLANNING: 'PLANNING',
  RESEARCHING: 'RESEARCHING',
  ANALYZING: 'ANALYZING',
  VERIFYING: 'VERIFYING',
  BUILDING: 'BUILDING',
  QA: 'QA',
  COMPLETE: 'COMPLETE',
};

export const STATE_ORDER = [
  MISSION_STATES.IDLE,
  MISSION_STATES.PLANNING,
  MISSION_STATES.RESEARCHING,
  MISSION_STATES.ANALYZING,
  MISSION_STATES.VERIFYING,
  MISSION_STATES.BUILDING,
  MISSION_STATES.QA,
  MISSION_STATES.COMPLETE,
];

export const STATE_CONFIG = {
  [MISSION_STATES.IDLE]: {
    id: MISSION_STATES.IDLE,
    label: 'IDLE',
    activeAgentId: null,
    coreState: 'idle',
    taskQueue: '00',
    processing: 'NO',
    engineStatus: 'STANDBY',
    activeAgentName: 'NONE // STANDBY',
    description: 'Autonomous cluster standing by. Awaiting operational directive.',
    badgeColor: 'text-[#756B7D]',
    dotColor: 'bg-[#554C5C]',
  },
  [MISSION_STATES.PLANNING]: {
    id: MISSION_STATES.PLANNING,
    label: 'PLANNING',
    activeAgentId: 'MOD.03', // Analyst Agent
    coreState: 'planning',
    taskQueue: '01',
    processing: 'YES',
    engineStatus: 'ACTIVE',
    activeAgentName: 'ANALYST AGENT',
    description: 'Decomposing operational directive into autonomous task graph.',
    badgeColor: 'text-[#C084FC]',
    dotColor: 'bg-[#A855F7]',
  },
  [MISSION_STATES.RESEARCHING]: {
    id: MISSION_STATES.RESEARCHING,
    label: 'RESEARCHING',
    activeAgentId: 'MOD.01', // Research Agent
    secondaryAgentId: 'MOD.02', // Browser Agent supporting retrieval
    coreState: 'researching',
    taskQueue: '02',
    processing: 'YES',
    engineStatus: 'ACTIVE',
    activeAgentName: 'RESEARCH AGENT',
    description: 'Semantic vector retrieval and deep intelligence indexing active.',
    badgeColor: 'text-[#C084FC]',
    dotColor: 'bg-[#A855F7]',
  },
  [MISSION_STATES.ANALYZING]: {
    id: MISSION_STATES.ANALYZING,
    label: 'ANALYZING',
    activeAgentId: 'MOD.03', // Analyst Agent
    coreState: 'analyzing',
    taskQueue: '03',
    processing: 'YES',
    engineStatus: 'ACTIVE',
    activeAgentName: 'ANALYST AGENT',
    description: 'Context compaction, synthesis, and inductive reasoning pipeline.',
    badgeColor: 'text-[#C084FC]',
    dotColor: 'bg-[#A855F7]',
  },
  [MISSION_STATES.VERIFYING]: {
    id: MISSION_STATES.VERIFYING,
    label: 'VERIFYING',
    activeAgentId: 'MOD.04', // Critic Agent
    coreState: 'verifying',
    taskQueue: '04',
    processing: 'YES',
    engineStatus: 'ACTIVE',
    activeAgentName: 'CRITIC AGENT',
    description: 'Logic verification, safety assertions, and constraint auditing.',
    badgeColor: 'text-[#E9D5FF]',
    dotColor: 'bg-[#C084FC]',
  },
  [MISSION_STATES.BUILDING]: {
    id: MISSION_STATES.BUILDING,
    label: 'BUILDING',
    activeAgentId: 'MOD.05', // Builder Agent
    coreState: 'building',
    taskQueue: '05',
    processing: 'YES',
    engineStatus: 'ACTIVE',
    activeAgentName: 'BUILDER AGENT',
    description: 'Synthesizing target code, scaffolds, and sandbox artifacts.',
    badgeColor: 'text-[#C084FC]',
    dotColor: 'bg-[#A855F7]',
  },
  [MISSION_STATES.QA]: {
    id: MISSION_STATES.QA,
    label: 'QA',
    activeAgentId: 'MOD.06', // QA Agent
    coreState: 'qa',
    taskQueue: '06',
    processing: 'YES',
    engineStatus: 'ACTIVE',
    activeAgentName: 'QA AGENT',
    description: 'Running assertion test suite and automated output validation.',
    badgeColor: 'text-[#E9D5FF]',
    dotColor: 'bg-[#39FF88]',
  },
  [MISSION_STATES.COMPLETE]: {
    id: MISSION_STATES.COMPLETE,
    label: 'COMPLETE',
    activeAgentId: null,
    coreState: 'complete',
    taskQueue: '00',
    processing: 'NO',
    engineStatus: 'STANDBY',
    activeAgentName: 'CLUSTER READY',
    description: 'Mission execution verified and completed. Outputs locked.',
    badgeColor: 'text-[#39FF88]',
    dotColor: 'bg-[#39FF88]',
  },
};
