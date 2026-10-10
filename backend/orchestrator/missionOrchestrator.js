const mongoose = require('mongoose');
const Mission = require('../models/Mission');
const MissionTask = require('../models/MissionTask');
const { generatePlan, planMission } = require('./missionPlanner');
const { createMissionTasks } = require('./taskManager');
const { executeMissionTask, TaskClaimConflictError } = require('./taskExecutor');
const { recordStageTransition, computeMissionMetrics } = require('../services/telemetry/telemetryService');
const { recordEvent, recordDecision, EVENT_TYPES, DECISION_TYPES } = require('../services/missionEventService');

/**
 * Maps a MissionTask to its authoritative lifecycle stage
 * @param {object} task
 * @returns {string} stage
 */
function mapTaskToStage(task) {
  if (!task) return 'research';
  const agentId = (task.agentId || '').toLowerCase();

  if (agentId === 'browser') return 'browser';
  if (agentId === 'research') return 'research';
  if (agentId === 'analyst') return 'analysis';
  if (agentId === 'critic') return 'critique';
  if (agentId === 'builder') return 'building';
  if (agentId === 'qa') return 'qa';

  const text = `${task.title || ''} ${task.description || ''}`.toLowerCase();
  if (/\b(browser|extract|navigate|visit|dom)\b/i.test(text)) {
    return 'browser';
  }
  if (/\b(research|gather|search)\b/i.test(text)) {
    return 'research';
  }
  if (/\b(analy|reasoning|evaluate)\b/i.test(text)) {
    return 'analysis';
  }
  if (/\b(critic|audit|review)\b/i.test(text)) {
    return 'critique';
  }
  if (/\b(qa|quality|test|assertions)\b/i.test(text)) {
    return 'qa';
  }
  if (/\b(build|artifact|deliverable|report)\b/i.test(text)) {
    return 'building';
  }
  return 'research';
}

/**
 * Creates the execution plan for a newly submitted mission.
 * Orchestrates plan generation through missionPlanner (AI with safe deterministic fallback)
 * and persists the tasks in MongoDB.
 * 
 * @param {object} mission - The persisted Mission document
 * @param {object} [options={}] - Optional planning options
 * @returns {Promise<{mission: object, tasks: Array<object>, planSource: string}>}
 */
async function createMissionExecutionPlan(mission, options = {}) {
  // 1. Validate mission
  if (!mission || !mission._id || typeof mission.objective !== 'string') {
    throw new Error('Valid mission document with _id and objective is required');
  }

  recordStageTransition(mission._id, { stage: 'planning', status: 'started' }).catch(() => {});

  try {
    // 2. Generate plan via missionPlanner (Gemini with deterministic fallback)
    const planResult = await generatePlan(mission.objective, {
      ...options,
      missionId: mission._id,
    });

    // 3. Persist mission tasks
    const tasks = await createMissionTasks(mission._id, planResult.tasks);

    recordStageTransition(mission._id, { stage: 'planning', status: 'completed' }).catch(() => {});
    recordEvent({
      missionId: mission._id,
      userId: mission.userId,
      type: EVENT_TYPES.TASK_ADDED,
      action: `Created initial planned execution tasks (${tasks.length})`,
      metadata: { count: tasks.length },
    }).catch(() => {});

    // 4. Return execution plan
    return {
      mission,
      tasks,
      planSource: planResult.source,
    };
  } catch (planError) {
    recordStageTransition(mission._id, { stage: 'planning', status: 'failed', metadata: { error: planError.message } }).catch(() => {});
    throw planError;
  }
}

/**
 * Executes a mission through its lifecycle:
 * planning -> running -> completed (or running -> failed).
 * 
 * Tasks are executed sequentially in strict order (1, 2, 3, 4).
 * Concurrency guard ensures a mission cannot be executed twice.
 * 
 * @param {mongoose.Types.ObjectId|string} missionId - The Mission ID to execute
 * @param {object} [options={}] - Execution options (e.g. testing delays/failures)
 * @returns {Promise<{mission: object, tasks: Array<object>, failed?: boolean, error?: string, alreadyRan?: boolean}>}
 */
async function executeMission(missionId, options = {}) {
  // 1. Validate missionId
  if (!missionId || !mongoose.Types.ObjectId.isValid(missionId)) {
    throw new Error('Invalid or missing missionId');
  }

  // 2. Transition mission: planning/queued -> running (atomic guard against duplicate execution)
  let mission = await Mission.findOneAndUpdate(
    { _id: missionId, status: { $in: ['planning', 'queued'] } },
    { $set: { status: 'running' } },
    { returnDocument: 'after' }
  );

  if (!mission) {
    const existing = await Mission.findById(missionId);
    if (!existing) {
      throw new Error(`Mission ${missionId} not found`);
    }
    // Mission is already completed or failed - exit safely without duplicating execution
    if (existing.status === 'completed' || existing.status === 'failed') {
      return { mission: existing, alreadyRan: true };
    }
    // Mission is already in 'running' state; orchestrator evaluates in-flight guard inside task loop
    mission = existing;
  }

  // 3. Load associated tasks to verify initial presence
  const initialTasks = await MissionTask.find({ missionId }).sort({ order: 1 });
  if (!initialTasks || initialTasks.length === 0) {
    await Mission.findByIdAndUpdate(missionId, { $set: { status: 'failed' } });
    throw new Error(`No tasks found for mission ${missionId}`);
  }

  // 4. Execute tasks strictly sequentially (dynamic pending queue)
  const executedTasks = [];
  const startTime = Date.now();
  const maxMissionDurationMs = options.totalTimeoutMs || 300000; // 5 minutes default
  try {
    while (true) {
      if (Date.now() - startTime > maxMissionDurationMs) {
        throw new Error(`Mission execution exceeded maximum allowable duration of ${maxMissionDurationMs}ms`);
      }

      // In-flight concurrency guard:
      // If any task is currently running or queued, an active worker is already executing this step.
      // Do not dispatch downstream pending tasks out-of-order!
      const inFlightTask = await MissionTask.findOne({
        missionId,
        status: { $in: ['running', 'queued'] },
      }).sort({ order: 1 });

      if (inFlightTask) {
        console.log(`[MISSION ORCHESTRATOR] Mission ${missionId} has in-flight task ${inFlightTask._id} (order ${inFlightTask.order}, status '${inFlightTask.status}'). Yielding loop cleanly.`);
        return {
          mission: await Mission.findById(missionId),
          tasks: executedTasks,
          alreadyActive: true,
          activeTaskId: inFlightTask._id,
        };
      }

      const nextTask = await MissionTask.findOne({
        missionId,
        status: 'pending',
      }).sort({ order: 1 });

      if (!nextTask) {
        break;
      }

      // Finding 1 Fix: Ensure no earlier task with a lower order has failed status.
      // A failed prerequisite halts the sequential pipeline; downstream tasks must never be dispatched.
      const failedPriorTask = await MissionTask.findOne({
        missionId,
        order: { $lt: nextTask.order },
        status: 'failed',
      }).sort({ order: 1 });

      if (failedPriorTask) {
        console.log(`[MISSION ORCHESTRATOR] Mission ${missionId} cannot dispatch task ${nextTask._id} (order ${nextTask.order}): prior task ${failedPriorTask._id} (order ${failedPriorTask.order}) is in failed state.`);
        const failedMission = await Mission.findOneAndUpdate(
          { _id: missionId, status: 'running' },
          { $set: { status: 'failed' } },
          { returnDocument: 'after' }
        ) || await Mission.findById(missionId);
        return {
          mission: failedMission,
          tasks: executedTasks,
          failed: true,
          error: `Prerequisite task order ${failedPriorTask.order} (${failedPriorTask.title || 'task'}) failed; halting pipeline.`,
        };
      }

      const taskStage = mapTaskToStage(nextTask);
      recordStageTransition(missionId, { stage: taskStage, status: 'started' }).catch(() => {});

      const taskOptions = {
        ...options,
        attempt: nextTask.executionMetadata?.attempt || 1,
        missionObjective: mission.objective,
      };

      let executed;
      try {
        executed = await executeMissionTask(nextTask._id, taskOptions);
        executedTasks.push(executed);
        recordStageTransition(missionId, { stage: taskStage, status: 'completed' }).catch(() => {});
      } catch (taskError) {
        if (taskError.code === 'TASK_CLAIM_CONFLICT' || taskError instanceof TaskClaimConflictError) {
          console.log(`[MISSION ORCHESTRATOR] Task ${nextTask._id} claim conflict encountered (${taskError.message}). Yielding loop cleanly.`);
          return {
            mission: await Mission.findById(missionId),
            tasks: executedTasks,
            claimConflict: true,
            conflictTaskId: nextTask._id,
          };
        }

        // Adaptive Mission Loop: Evaluate task failure
        const { evaluateTaskFailure } = require('../services/adaptiveMissionService');
        const adaptiveDecision = await evaluateTaskFailure({
          missionId,
          taskId: nextTask._id,
          error: taskError,
          currentAttempt: nextTask.executionMetadata?.attempt || 1,
          missionStartTime: startTime,
          maxMissionDurationMs,
          options,
        }).catch((evalErr) => {
          console.warn('[ADAPTIVE LOOP] Failure evaluation error:', evalErr.message);
          return { action: 'BLOCK' };
        });

        if (adaptiveDecision.action === 'RETRY') {
          // Re-queued as 'pending' for adaptive retry; continue orchestrator loop
          continue;
        }

        taskError._blockDecisionRecorded = true;
        throw taskError;
      }

      // Adaptive Mission Loop: Evaluate evidence sufficiency & expand if research task
      const isResearchTask = executed.agentId === 'research' ||
        /\b(research|gather|information)\b/i.test(executed.title || '');

      if (isResearchTask && options.skipBrowserHandoff !== true) {
        const { evaluateEvidenceSufficiency } = require('../services/adaptiveMissionService');
        await evaluateEvidenceSufficiency({
          missionId,
          taskId: executed._id,
          executedResult: executed,
          missionObjective: mission.objective,
          currentTaskOrder: executed.order,
          options,
        }).catch((evalErr) => {
          console.warn('[ADAPTIVE LOOP] Evidence sufficiency evaluation error:', evalErr.message);
        });
      }
    }

    // Verify mission integrity before completion: cannot mark completed if any task failed
    const failedTask = await MissionTask.findOne({ missionId, status: 'failed' });
    if (failedTask) {
      console.log(`[MISSION ORCHESTRATOR] Mission ${missionId} cannot complete: task ${failedTask._id} (order ${failedTask.order}) is in failed status.`);
      const failedMission = await Mission.findOneAndUpdate(
        { _id: missionId, status: 'running' },
        { $set: { status: 'failed' } },
        { returnDocument: 'after' }
      ) || await Mission.findById(missionId);
      return {
        mission: failedMission,
        tasks: executedTasks,
        failed: true,
        error: `Mission contains failed task order ${failedTask.order} (${failedTask.title || 'task'}); cannot mark completed.`,
      };
    }

    // 5. Transition mission: running -> completed (atomic conditional update for idempotent terminal transition)
    const completedMission = await Mission.findOneAndUpdate(
      { _id: missionId, status: 'running' },
      { $set: { status: 'completed' } },
      { returnDocument: 'after' }
    );

    if (!completedMission) {
      // Finding 2 Fix: Conditional update matched no document.
      // Another concurrent worker or execution path already performed the terminal transition.
      // Do not emit duplicate terminal events or stage transitions.
      const currentMission = await Mission.findById(missionId);
      return {
        mission: currentMission,
        tasks: executedTasks,
        failed: currentMission?.status === 'failed',
        alreadyRan: true,
      };
    }

    // Only the single winning caller that successfully performed running -> completed emits terminal events
    await recordStageTransition(missionId, { stage: 'completed', status: 'completed' }).catch(() => {});
    await computeMissionMetrics(missionId).catch(() => {});
    await recordEvent({
      missionId,
      userId: mission.userId,
      type: EVENT_TYPES.MISSION_COMPLETED,
      action: 'Mission completed all tasks successfully',
      outcome: 'completed',
    }).catch(() => {});

    return {
      mission: completedMission,
      tasks: executedTasks,
      failed: false,
    };
  } catch (executionError) {
    // 6. Transition mission: running -> failed on any task error
    await recordStageTransition(missionId, {
      stage: 'failed',
      status: 'failed',
      metadata: { error: executionError.message },
    }).catch(() => {});
    await computeMissionMetrics(missionId).catch(() => {});

    if (!executionError._blockDecisionRecorded) {
      await recordDecision({
        missionId,
        decisionType: DECISION_TYPES.BLOCK_MISSION,
        reason: executionError.message,
        action: 'Halt mission execution pipeline',
        outcome: 'failed',
      }).catch(() => {});
    }
    await recordEvent({
      missionId,
      type: EVENT_TYPES.MISSION_FAILED,
      reason: executionError.message,
      action: 'Mark mission status as failed',
      outcome: 'failed',
    }).catch(() => {});

    console.error(`[MISSION ORCHESTRATOR] Mission ${missionId} task execution failed:`, executionError.message);
    const failedMission = await Mission.findOneAndUpdate(
      { _id: missionId, status: 'running' },
      { $set: { status: 'failed' } },
      { returnDocument: 'after' }
    ) || await Mission.findById(missionId);

    return {
      mission: failedMission,
      tasks: executedTasks,
      error: executionError.message,
      failed: true,
    };
  }
}

module.exports = {
  createMissionExecutionPlan,
  executeMission,
};
