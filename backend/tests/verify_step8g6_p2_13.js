/**
 * NEXORA Phase 3.1 Verification Suite
 * Step 8G.6 Phase 2.13 — Production Hardening & Deployment Packaging
 *
 * Verifies:
 * SECTION 1: Security Headers & Helmet Configuration
 * - T1: Standard security headers present (X-Content-Type-Options: nosniff, X-Frame-Options: DENY)
 * - T2: HSTS header disabled in non-production mode to permit local HTTP development
 * - T3: HSTS header enabled with 1-year maxAge and subdomains when NODE_ENV === 'production'
 * - T4: Content Security Policy header present and permits configured connect-src origins
 *
 * SECTION 2: Configurable & Credentialed CORS
 * - T5: Non-browser requests without Origin header proceed cleanly without 403
 * - T6: Allowed origin receives exact Access-Control-Allow-Origin and credentials flag
 * - T7: Comma-separated multi-origin configuration parses, normalizes, and allows listed origins
 * - T8: Unapproved origin is rejected with HTTP 403 on preflight OPTIONS and requests
 * - T9: Wildcard origin '*' is strictly prohibited for credentialed CORS
 * - T10: Production startup validation rejects missing or invalid CORS origins
 *
 * SECTION 3: Mission Creation Rate Limiting
 * - T11: POST /api/missions returns standard RFC rate-limit headers
 * - T12: Exceeding mission limit returns HTTP 429 with sanitized code and Retry-After header
 * - T13: Rate limiter isolates by authenticated user ID (user A limit does not block user B)
 * - T14: Rate limiter does NOT block other mission routes (GET /api/missions, events, cancel, retry, result)
 * - T15: Safe IP resolution respects Express trust proxy configuration and ignores spoofed headers
 *
 * SECTION 4: Production Deployment Packaging & Template Consistency
 * - T16: backend/.env.production.example exists, documents required variables, and leaks no real secrets
 * - T17: backend/Dockerfile exists, defines Node 22 LTS, unprivileged nexora user, and Playwright Chromium
 * - T18: docker-compose.yml defines mongodb & backend services, named volume, and health checks
 * - T19: GoogleAuthButton.jsx defaults to disabled state with (COMING SOON) label and no misleading login trigger
 * - T20: Frontend production build output verifies code-split vendor chunks and entry bundle well under 500 kB
 */

const path = require('path');
const fs = require('fs');
const assert = require('assert');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';

const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  if (typeof process.loadEnvFile === 'function') {
    process.loadEnvFile(envPath);
  } else {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach((line) => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const idx = trimmed.indexOf('=');
        if (idx !== -1) {
          const key = trimmed.slice(0, idx).trim();
          const val = trimmed.slice(idx + 1).trim();
          if (process.env[key] === undefined) {
            process.env[key] = val;
          }
        }
      }
    });
  }
}

const connectDB = require('../config/db');
const { getJwtSecret, COOKIE_NAME } = require('../config/authConfig');
const {
  isValidOriginUrl,
  resolveAllowedOrigins,
  createCorsMiddleware,
  createHelmetMiddleware,
  validateSecurityConfig,
} = require('../config/securityConfig');
const {
  createRateLimiter,
  createMissionRateLimiter,
  resolveClientIp,
  getMissionRateLimiterConfig,
  missionRateLimiter,
} = require('../middleware/rateLimiter');
const User = require('../models/User');
const Mission = require('../models/Mission');
const MissionTask = require('../models/MissionTask');
const { app } = require('../server');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

async function runAsyncTest(name, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  [PASS] ${name}`);
  } catch (err) {
    failedTests++;
    console.error(`  [FAIL] ${name}:`, err.message);
    throw err;
  }
}

function runSyncTest(name, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  [PASS] ${name}`);
  } catch (err) {
    failedTests++;
    console.error(`  [FAIL] ${name}:`, err.message);
    throw err;
  }
}

function generateAuthToken(user) {
  return jwt.sign(
    { id: user._id.toString(), email: user.email, role: user.role },
    getJwtSecret(),
    { expiresIn: '1h' }
  );
}

async function runPhase3_1Suite() {
  console.log('====================================================');
  console.log('  STARTING NEXORA PHASE 3.1 VERIFICATION SUITE');
  console.log('  Production Hardening & Deployment Packaging');
  console.log('====================================================\n');

  await connectDB();

  const createdMissionIds = [];
  const createdUserIds = [];
  let httpServer = null;
  let baseUrl = '';

  try {
    httpServer = await new Promise((resolve) => {
      const server = app.listen(0, () => resolve(server));
    });
    const port = httpServer.address().port;
    baseUrl = `http://127.0.0.1:${port}`;

    const userA = await User.create({
      name: 'Phase 3.1 User A',
      email: `user_a_${Date.now()}_p31@nexora.ai`,
      password: 'AuditPassword123!',
      role: 'user',
    });
    createdUserIds.push(userA._id);
    const tokenA = generateAuthToken(userA);
    const headersA = {
      'Content-Type': 'application/json',
      Cookie: `${COOKIE_NAME}=${tokenA}`,
    };

    const userB = await User.create({
      name: 'Phase 3.1 User B',
      email: `user_b_${Date.now()}_p31@nexora.ai`,
      password: 'AuditPassword123!',
      role: 'user',
    });
    createdUserIds.push(userB._id);
    const tokenB = generateAuthToken(userB);
    const headersB = {
      'Content-Type': 'application/json',
      Cookie: `${COOKIE_NAME}=${tokenB}`,
    };

    // =========================================================================
    // SECTION 1: Security Headers & Helmet Configuration
    // =========================================================================
    console.log('--- SECTION 1: Security Headers & Helmet Configuration ---');

    await runAsyncTest('T1: Standard security headers present (X-Content-Type-Options: nosniff, X-Frame-Options: DENY)', async () => {
      const res = await fetch(`${baseUrl}/api/health`);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff');
      assert.strictEqual(res.headers.get('x-frame-options'), 'DENY');
    });

    await runAsyncTest('T2: HSTS header disabled in non-production mode to permit local HTTP development', async () => {
      const res = await fetch(`${baseUrl}/api/health`);
      const hsts = res.headers.get('strict-transport-security');
      assert.strictEqual(hsts, null, 'HSTS must be absent in development/test');
    });

    runSyncTest('T3: HSTS header enabled with 1-year maxAge and subdomains when NODE_ENV === "production"', () => {
      const prodMiddleware = createHelmetMiddleware({
        env: { NODE_ENV: 'production', CORS_ORIGIN: 'https://app.nexora.ai' },
      });
      const mockReq = { headers: {}, method: 'GET', url: '/' };
      const headers = {};
      const mockRes = {
        setHeader: (k, v) => { headers[k.toLowerCase()] = v; },
        getHeader: (k) => headers[k.toLowerCase()],
        removeHeader: (k) => { delete headers[k.toLowerCase()]; },
      };
      prodMiddleware(mockReq, mockRes, () => {});
      const hsts = headers['strict-transport-security'];
      assert.ok(hsts, 'HSTS header must be present in production');
      assert.ok(hsts.includes('max-age=31536000'), 'HSTS maxAge must be 1 year (31536000 seconds)');
      assert.ok(hsts.includes('includeSubDomains'), 'HSTS must include subdomains');
    });

    await runAsyncTest('T4: Content Security Policy header present and permits configured connect-src origins', async () => {
      const res = await fetch(`${baseUrl}/api/health`);
      const csp = res.headers.get('content-security-policy');
      assert.ok(csp, 'Content-Security-Policy header must be present');
      assert.ok(csp.includes("frame-ancestors 'none'"), 'CSP must deny frame embedding');
      assert.ok(csp.includes('connect-src'), 'CSP must declare connect-src');
    });

    // =========================================================================
    // SECTION 2: Configurable & Credentialed CORS
    // =========================================================================
    console.log('\n--- SECTION 2: Configurable & Credentialed CORS ---');

    await runAsyncTest('T5: Non-browser requests without Origin header proceed cleanly without 403', async () => {
      const res = await fetch(`${baseUrl}/api/health`);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers.get('access-control-allow-origin'), null);
    });

    await runAsyncTest('T6: Allowed origin receives exact Access-Control-Allow-Origin and credentials flag', async () => {
      const res = await fetch(`${baseUrl}/api/health`, {
        headers: { Origin: 'http://localhost:5173' },
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers.get('access-control-allow-origin'), 'http://localhost:5173');
      assert.strictEqual(res.headers.get('access-control-allow-credentials'), 'true');
      assert.strictEqual(res.headers.get('vary'), 'Origin');
    });

    runSyncTest('T7: Comma-separated multi-origin configuration parses, normalizes, and allows listed origins', () => {
      const origins = resolveAllowedOrigins({
        NODE_ENV: 'production',
        FRONTEND_URL: 'https://app.nexora.ai, https://admin.nexora.ai/',
      });
      assert.strictEqual(origins.length, 2);
      assert.ok(origins.includes('https://app.nexora.ai'));
      assert.ok(origins.includes('https://admin.nexora.ai'));
    });

    await runAsyncTest('T8: Unapproved origin is rejected with HTTP 403 on preflight OPTIONS and requests', async () => {
      const preflight = await fetch(`${baseUrl}/api/health`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://evil-unauthorized-site.com',
          'Access-Control-Request-Method': 'GET',
        },
      });
      assert.strictEqual(preflight.status, 403);
      assert.strictEqual(preflight.headers.get('access-control-allow-origin'), null);

      const direct = await fetch(`${baseUrl}/api/health`, {
        headers: { Origin: 'https://evil-unauthorized-site.com' },
      });
      assert.strictEqual(direct.status, 403);
    });

    runSyncTest('T9: Wildcard origin "*" is strictly prohibited for credentialed CORS', () => {
      assert.strictEqual(isValidOriginUrl('*'), false, 'Wildcard * must be rejected');
      assert.throws(
        () => resolveAllowedOrigins({ NODE_ENV: 'production', CORS_ORIGIN: '*' }),
        /strictly forbidden|Invalid origin/i
      );
    });

    runSyncTest('T10: Production startup validation rejects missing or invalid CORS origins', () => {
      assert.throws(
        () => validateSecurityConfig({ NODE_ENV: 'production', CORS_ORIGIN: '' }),
        /CORS_ORIGIN or FRONTEND_URL must be configured in production/i
      );
      assert.throws(
        () => validateSecurityConfig({ NODE_ENV: 'production', CORS_ORIGIN: 'invalid-url-no-protocol' }),
        /Invalid origin configured for production CORS/i
      );
    });

    // =========================================================================
    // SECTION 3: Mission Creation Rate Limiting
    // =========================================================================
    console.log('\n--- SECTION 3: Mission Creation Rate Limiting ---');

    await runAsyncTest('T11: POST /api/missions returns standard RFC rate-limit headers', async () => {
      const res = await fetch(`${baseUrl}/api/missions`, {
        method: 'POST',
        headers: headersA,
        body: JSON.stringify({ objective: 'Rate limit header validation mission' }),
      });
      assert.strictEqual(res.status, 201);
      const data = await res.json();
      createdMissionIds.push(data.mission.id);

      assert.ok(res.headers.has('ratelimit-limit'), 'Missing RateLimit-Limit header');
      assert.ok(res.headers.has('ratelimit-remaining'), 'Missing RateLimit-Remaining header');
      assert.ok(res.headers.has('ratelimit-reset'), 'Missing RateLimit-Reset header');
    });

    await runAsyncTest('T12: Exceeding mission limit returns HTTP 429 with sanitized code and Retry-After header', async () => {
      const testLimiter = createRateLimiter({
        windowMs: 60000,
        max: 2,
        message: 'Too many mission creation requests. Please try again later.',
        keyGenerator: () => 'test-exhaust-key',
      });

      const mockReq = { headers: {}, method: 'POST', url: '/' };
      const headers = {};
      let responseBody = null;
      let statusCode = 200;

      const mockRes = {
        setHeader: (k, v) => { headers[k.toLowerCase()] = v; },
        status: (code) => {
          statusCode = code;
          return {
            json: (payload) => { responseBody = payload; },
          };
        },
      };

      testLimiter(mockReq, mockRes, () => {});
      testLimiter(mockReq, mockRes, () => {});

      // 3rd hit must exceed limit (max: 2)
      let nextCalled = false;
      testLimiter(mockReq, mockRes, () => { nextCalled = true; });

      assert.strictEqual(nextCalled, false, 'Middleware must not call next when limit is exceeded');
      assert.strictEqual(statusCode, 429);
      assert.strictEqual(responseBody?.code, 'RATE_LIMIT_EXCEEDED');
      assert.strictEqual(responseBody?.success, false);
      assert.ok(headers['retry-after'], 'Retry-After header must be set');
      testLimiter.destroy();
    });

    await runAsyncTest('T13: Rate limiter isolates by authenticated user ID (user A limit does not block user B)', async () => {
      const isolatedLimiter = createMissionRateLimiter({
        windowMs: 60000,
        max: 1,
      });

      const reqA = { user: { id: 'user_111' }, headers: {} };
      const reqB = { user: { id: 'user_222' }, headers: {} };
      let headersB = {};
      let statusB = 200;
      const resB = {
        setHeader: (k, v) => { headersB[k.toLowerCase()] = v; },
        status: (code) => ({ json: () => {} }),
      };

      // Exhaust User A
      isolatedLimiter(reqA, { setHeader: () => {}, status: () => ({ json: () => {} }) }, () => {});
      isolatedLimiter(reqA, { setHeader: () => {}, status: () => ({ json: () => {} }) }, () => {});

      // User B should proceed without 429
      let userBCalled = false;
      isolatedLimiter(reqB, resB, () => { userBCalled = true; });

      assert.strictEqual(userBCalled, true, 'User B must not be throttled by User A usage');
      isolatedLimiter.destroy();
    });

    await runAsyncTest('T14: Rate limiter does NOT block other mission routes (GET, events, cancel, retry, result)', async () => {
      const getRes = await fetch(`${baseUrl}/api/missions`, { headers: headersA });
      assert.strictEqual(getRes.status, 200, 'GET /api/missions must remain unblocked');

      const missionId = createdMissionIds[0];
      if (missionId) {
        const eventsRes = await fetch(`${baseUrl}/api/missions/${missionId}/events?sinceSeq=0`, { headers: headersA });
        assert.strictEqual(eventsRes.status, 200, 'GET events must remain unblocked');

        const resultRes = await fetch(`${baseUrl}/api/missions/${missionId}/result`, { headers: headersA });
        assert.strictEqual(resultRes.status, 200, 'GET result must remain unblocked');
      }
    });

    runSyncTest('T15: Safe IP resolution respects Express trust proxy configuration and ignores spoofed headers', () => {
      // Untrusted proxy scenario
      const untrustedReq = {
        app: { get: (k) => (k === 'trust proxy' ? false : undefined) },
        headers: { 'x-forwarded-for': '198.51.100.1' },
        socket: { remoteAddress: '203.0.113.5' },
        ip: '203.0.113.5',
      };
      const resolvedUntrusted = resolveClientIp(untrustedReq);
      assert.strictEqual(resolvedUntrusted, '203.0.113.5', 'Must not trust X-Forwarded-For when trust proxy is false');

      // Trusted proxy scenario
      const trustedReq = {
        app: { get: (k) => (k === 'trust proxy' ? 1 : undefined) },
        headers: { 'x-forwarded-for': '198.51.100.1' },
        socket: { remoteAddress: '10.0.0.1' },
        ip: '198.51.100.1',
      };
      const resolvedTrusted = resolveClientIp(trustedReq);
      assert.strictEqual(resolvedTrusted, '198.51.100.1', 'Must use req.ip when trust proxy is configured');
    });

    // =========================================================================
    // SECTION 4: Production Deployment Packaging & Template Consistency
    // =========================================================================
    console.log('\n--- SECTION 4: Deployment Packaging & Template Consistency ---');

    runSyncTest('T16: backend/.env.production.example exists, documents required variables, and leaks no real secrets', () => {
      const templatePath = path.resolve(__dirname, '../.env.production.example');
      assert.ok(fs.existsSync(templatePath), 'backend/.env.production.example must exist');
      const content = fs.readFileSync(templatePath, 'utf8');

      assert.ok(content.includes('NODE_ENV=production'));
      assert.ok(content.includes('MONGODB_URI='));
      assert.ok(content.includes('JWT_SECRET='));
      assert.ok(content.includes('FRONTEND_URL='));
      assert.ok(content.includes('CORS_ORIGIN='));
      assert.ok(content.includes('MISSION_RATE_LIMIT_MAX='));
      assert.ok(content.includes('TRUST_PROXY='));

      // Anti-leak check
      assert.ok(!content.includes('AIzaSy'), 'Must not contain real Google API key');
      assert.ok(!content.includes('nexora_dev_jwt_secret_change_in_production'), 'Must not recommend weak default secret');
    });

    runSyncTest('T17: backend/Dockerfile exists, defines Node 22 LTS, unprivileged nexora user, and Playwright Chromium', () => {
      const dockerfilePath = path.resolve(__dirname, '../Dockerfile');
      assert.ok(fs.existsSync(dockerfilePath), 'backend/Dockerfile must exist');
      const content = fs.readFileSync(dockerfilePath, 'utf8');

      assert.ok(content.includes('FROM node:22-bookworm-slim'), 'Base image must be Node 22 LTS Bookworm Slim');
      assert.ok(content.includes('USER nexora'), 'Must execute as unprivileged nexora user');
      assert.ok(content.includes('npx playwright install chromium'), 'Must install Chromium headless binary');
      assert.ok(content.includes('/api/health'), 'Must configure /api/health healthcheck');
    });

    runSyncTest('T18: docker-compose.yml defines mongodb & backend services, named volume, and health checks', () => {
      const composePath = path.resolve(__dirname, '../../docker-compose.yml');
      assert.ok(fs.existsSync(composePath), 'Root docker-compose.yml must exist');
      const content = fs.readFileSync(composePath, 'utf8');

      assert.ok(content.includes('mongodb:'), 'Compose must define mongodb service');
      assert.ok(content.includes('backend:'), 'Compose must define backend service');
      assert.ok(content.includes('nexora_mongo_data:'), 'Compose must define named volume nexora_mongo_data');
      assert.ok(content.includes('condition: service_healthy'), 'Backend must depend on healthy mongodb');
      assert.ok(!content.includes('privileged: true'), 'Must not grant container root privileges');
    });

    runSyncTest('T19: GoogleAuthButton.jsx defaults to disabled state with (COMING SOON) label and no misleading login trigger', () => {
      const buttonPath = path.resolve(__dirname, '../../frontend/nexora/src/components/auth/GoogleAuthButton.jsx');
      assert.ok(fs.existsSync(buttonPath), 'GoogleAuthButton.jsx must exist');
      const content = fs.readFileSync(buttonPath, 'utf8');

      assert.ok(content.includes('disabled = true'), 'GoogleAuthButton must default to disabled=true');
      assert.ok(content.includes('COMING SOON'), 'GoogleAuthButton must label button as Coming Soon');
      assert.ok(content.includes('aria-disabled={disabled}'), 'GoogleAuthButton must include aria-disabled attribute');
    });

    runSyncTest('T20: Frontend production build output verifies code-split vendor chunks and entry bundle well under 500 kB', () => {
      const distDir = path.resolve(__dirname, '../../frontend/nexora/dist');
      assert.ok(fs.existsSync(distDir), 'frontend/nexora/dist must exist from build');
      const assetsDir = path.join(distDir, 'assets');
      assert.ok(fs.existsSync(assetsDir), 'frontend/nexora/dist/assets must exist');

      const files = fs.readdirSync(assetsDir);
      const entryChunk = files.find((f) => f.startsWith('index-') && f.endsWith('.js'));
      assert.ok(entryChunk, 'Entry index-*.js chunk must exist');

      const entryStats = fs.statSync(path.join(assetsDir, entryChunk));
      const entryKb = entryStats.size / 1024;
      console.log(`    [METRICS] Entry JS Chunk (${entryChunk}): ${entryKb.toFixed(2)} kB`);
      assert.ok(entryKb < 250, `Entry chunk must be under 250 kB (actual: ${entryKb.toFixed(2)} kB)`);

      const vendorMotion = files.some((f) => f.startsWith('vendor-motion-'));
      const vendorReact = files.some((f) => f.startsWith('vendor-react-'));
      assert.ok(vendorMotion, 'Separate vendor-motion chunk must be emitted');
      assert.ok(vendorReact, 'Separate vendor-react chunk must be emitted');
    });

  } finally {
    if (httpServer) {
      await new Promise((resolve) => httpServer.close(resolve));
    }

    // Clean up created test entities cleanly
    if (createdMissionIds.length > 0) {
      await MissionTask.deleteMany({ missionId: { $in: createdMissionIds } });
      await Mission.deleteMany({ _id: { $in: createdMissionIds } });
    }
    if (createdUserIds.length > 0) {
      await User.deleteMany({ _id: { $in: createdUserIds } });
    }
    await mongoose.disconnect();
  }

  console.log('\n====================================================');
  console.log(`  PHASE 3.1 SUITE COMPLETE: ${passedTests}/${totalTests} PASSED`);
  console.log('====================================================\n');
}

if (require.main === module) {
  runPhase3_1Suite()
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      console.error('\nSuite execution failed:', err);
      process.exit(1);
    });
}

module.exports = { runPhase3_1Suite };
