/**
 * DEMO EXECUTION ENGINE (SIMULATION)
 * Frontend-only demonstration event engine for NEXORA.
 *
 * PURPOSE:
 * Simulates real-time-style autonomous agent execution telemetry
 * until the backend orchestrator and WebSocket stream are implemented.
 *
 * SAFETY GUARANTEES:
 * - Emits strictly structured UI-safe execution events.
 * - Does NOT fabricate real research sources, external URLs, or citations.
 * - Does NOT persist fake events to MongoDB or localStorage.
 * - Isolated lifecycle with full stop() and cleanup() controls.
 * - Guarded against duplicate active timers.
 */

import { DEMO_EVENT_SEQUENCE } from '../constants/executionEvents';

function formatTimeString(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

class DemoExecutionEngine {
  constructor() {
    this.activeTimers = [];
    this.isRunning = false;
    this.missionId = null;
  }

  /**
   * Check if simulation is currently active
   */
  isActive() {
    return this.isRunning;
  }

  /**
   * Start deterministic demonstration event sequence
   *
   * @param {Object} mission - MongoDB mission record { id, objective, ... }
   * @param {Object} callbacks - Handler callbacks
   * @param {Function} callbacks.onEvent - Called when a new execution event is emitted
   * @param {Function} callbacks.onStateChange - Called to update systemState and active agents
   * @param {Function} callbacks.onEvidenceUpdate - Called when an evidence card updates
   * @param {Function} callbacks.onComplete - Called when the entire sequence finishes
   */
  start(mission, { onEvent, onStateChange, onEvidenceUpdate, onComplete } = {}) {
    // Prevent duplicate runners: stop any existing simulation first
    this.stop();

    this.isRunning = true;
    this.missionId = mission?.id || 'LOCAL-SIM';

    let cumulativeDelay = 100; // Small initial tick

    DEMO_EVENT_SEQUENCE.forEach((template, index) => {
      const isLast = index === DEMO_EVENT_SEQUENCE.length - 1;

      const timerId = setTimeout(() => {
        if (!this.isRunning) return;

        const now = new Date();
        const eventId = `evt-${Date.now()}-${index}`;

        const event = {
          id: eventId,
          timestamp: now.toISOString(),
          timeString: formatTimeString(now),
          missionId: this.missionId,
          type: template.type,
          agentId: template.agentId,
          agentTag: template.agentTag,
          title: template.title,
          description: template.description,
          status: isLast ? 'completed' : 'active',
          systemState: template.systemState,
          activeAgentId: template.activeAgentId,
          secondaryAgentId: template.secondaryAgentId,
        };

        // Emit new event to execution feed
        if (typeof onEvent === 'function') {
          onEvent(event);
        }

        // Synchronize systemState and active agent highlighting
        if (typeof onStateChange === 'function') {
          onStateChange(template.systemState, template.activeAgentId, template.secondaryAgentId);
        }

        // Synchronize evidence stream placeholder update if defined
        if (template.evidenceUpdate && typeof onEvidenceUpdate === 'function') {
          onEvidenceUpdate({
            ...template.evidenceUpdate,
            timestamp: now.toISOString(),
            timeString: formatTimeString(now),
          });
        }

        // If this is the final event, conclude simulation
        if (isLast) {
          this.isRunning = false;
          if (typeof onComplete === 'function') {
            onComplete();
          }
        }
      }, cumulativeDelay);

      this.activeTimers.push(timerId);
      cumulativeDelay += template.delayMs;
    });
  }

  /**
   * Stop simulation immediately and clear all scheduled timers
   */
  stop() {
    this.activeTimers.forEach((timerId) => clearTimeout(timerId));
    this.activeTimers = [];
    this.isRunning = false;
    this.missionId = null;
  }
}

// Export singleton engine instance for unified app lifecycle
export const demoExecutionEngine = new DemoExecutionEngine();
export default demoExecutionEngine;
