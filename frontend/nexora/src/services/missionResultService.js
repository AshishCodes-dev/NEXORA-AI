/**
 * Mission Result API Service (Frontend Client)
 * 
 * Interacts with the authenticated backend endpoint:
 * GET /api/missions/:missionId/result
 * 
 * Safety & Security Guarantees:
 * - Uses credentials: "include" for HttpOnly session cookie transmission.
 * - Sourced strictly by missionId path parameter.
 * - Never transmits client-side userId, API keys, or secrets.
 * - Handles 401, 404, 500, network errors, and malformed responses safely.
 */

const BACKEND_URL = 'http://localhost:5000';

export class MissionResultError extends Error {
  constructor(message, status = null, code = null) {
    super(message);
    this.name = 'MissionResultError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Fetches the complete aggregated final result for a mission.
 * 
 * @param {string} missionId - MongoDB ObjectId string of the mission
 * @param {object} [options={}]
 * @param {AbortSignal} [options.signal] - Optional AbortSignal for request cancellation
 * @returns {Promise<{
 *   success: boolean,
 *   mission: object,
 *   tasks: Array<object>,
 *   status: string,
 *   resultStatus: { ready: boolean, verification: string, qaVerdict: string|null },
 *   artifact: object|null,
 *   evidence: Array<object>,
 *   analysis: Array<object>,
 *   critique: Array<object>,
 *   qa: object|null
 * }>}
 */
export async function getMissionResult(missionId, options = {}) {
  if (!missionId || typeof missionId !== 'string' || !missionId.trim()) {
    throw new MissionResultError('Mission ID is required', 400, 'INVALID_MISSION_ID');
  }

  const cleanMissionId = missionId.trim();
  const url = `${BACKEND_URL}/api/missions/${encodeURIComponent(cleanMissionId)}/result`;

  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
      credentials: 'include',
      signal: options.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw err; // Allow abort to be handled upstream
    }
    throw new MissionResultError(
      'NEXORA backend gateway unreachable. Check network connection.',
      null,
      'NETWORK_ERROR'
    );
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new MissionResultError(
      `Unexpected non-JSON response from backend (HTTP ${response.status})`,
      response.status,
      'PARSE_ERROR'
    );
  }

  // Handle HTTP status errors cleanly
  if (!response.ok || !data?.success) {
    if (response.status === 401) {
      throw new MissionResultError(
        data?.message || 'Authentication required. Please log in.',
        401,
        'UNAUTHENTICATED'
      );
    }

    if (response.status === 404) {
      throw new MissionResultError(
        data?.error || 'Mission not found or access denied.',
        404,
        'NOT_FOUND'
      );
    }

    if (response.status >= 500) {
      throw new MissionResultError(
        data?.error || 'Server error retrieving mission result.',
        response.status,
        'SERVER_ERROR'
      );
    }

    throw new MissionResultError(
      data?.error || data?.message || `Failed to retrieve mission result (HTTP ${response.status})`,
      response.status,
      'UNKNOWN_ERROR'
    );
  }

  return data;
}

export default {
  getMissionResult,
  MissionResultError,
};
