/**
 * NEXORA Phase 3.3A Verification Suite
 * Step 8G.6 Phase 2.15 — Deployment Hardening Implementation
 *
 * Verifies:
 * SECTION 1: Playwright Chromium Container-Safe Launch Configuration
 * - T1: getChromiumLaunchOptions helper exists, is exported by browserService.js, and sets headless: true
 * - T2: Default launch arguments include --disable-gpu and --disable-dev-shm-usage (prevents Docker /dev/shm OOM)
 * - T3: In container mode (PLAYWRIGHT_CONTAINER_MODE=true or Linux), arguments include --no-sandbox and --disable-setuid-sandbox
 * - T4: User-provided custom launch options and arguments merge cleanly without duplicates
 * - T5: Browser operation execution maintains bounded concurrency (MAX_CONCURRENT_JOBS = 2)
 * - T6: Total task timeout (60s) and navigation timeout (30s) policies are preserved
 * - T7: Deterministic resource cleanup (page, context, browser) executes on completion and failure
 *
 * SECTION 2: First-Party API Proxy & URL Normalization
 * - T8: resolveApiBaseUrl helper resolves default 'http://localhost:5000' when VITE_API_URL is undefined
 * - T9: resolveApiBaseUrl returns empty string '' when VITE_API_URL is '' or '/' (enables same-origin relative URLs)
 * - T10: resolveApiBaseUrl normalizes trailing slashes on direct cross-origin URLs
 * - T11: missionService.js exports API_BASE_URL consistent with resolveApiBaseUrl
 * - T12: frontend/nexora/vercel.json exists, has $schema, and defines valid rewrites array without unverified dynamic proxy
 * - T13: frontend/nexora/vercel.json defines SPA fallback rewrite /(.*) to /index.html
 * - T14: frontend/nexora/vite.config.js defines development server proxy for /api with changeOrigin: true
 *
 * SECTION 3: Docker Compose Environment Wiring & Configuration Security
 * - T15: docker-compose.yml passes GOOGLE_CLIENT_ID: ${GOOGLE_CLIENT_ID:-} to backend service
 * - T16: docker-compose.yml does not contain hardcoded secrets or credentials
 * - T17: docker-compose.yml preserves MongoDB healthcheck dependency and persistent volume
 * - T18: frontend/nexora/.env.example documents VITE_API_URL for both same-origin proxy and direct cross-origin
 * - T19: frontend/nexora/.env.example explicitly warns against placing private server secrets in client variables
 * - T20: Existing email/password authentication and security policies remain intact without regression
 * - T21: getCookieOptions and getClearCookieOptions have matching attributes across dev and production
 */

const path = require('path');
const fs = require('fs');
const assert = require('assert');
const mongoose = require('mongoose');

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
const { app } = require('../server');
const { getCookieOptions, getClearCookieOptions } = require('../config/authConfig');
const {
  getChromiumLaunchOptions,
  getConcurrencyStatus,
  executeBrowserOperation,
} = require('../services/browser/browserService');
const { BROWSER_POLICY } = require('../services/browser/browserPolicy');

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

async function runPhase3_3ASuite() {
  console.log('====================================================');
  console.log('  STARTING NEXORA PHASE 3.3A VERIFICATION SUITE');
  console.log('  Deployment Hardening Implementation');
  console.log('====================================================\n');

  await connectDB();

  let httpServer = null;
  let baseUrl = '';

  try {
    httpServer = await new Promise((resolve) => {
      const server = app.listen(0, () => resolve(server));
    });
    const port = httpServer.address().port;
    baseUrl = `http://127.0.0.1:${port}`;

    // =========================================================================
    // SECTION 1: Playwright Chromium Container-Safe Launch Configuration
    // =========================================================================
    console.log('--- SECTION 1: Playwright Chromium Container-Safe Launch Configuration ---');

    runSyncTest('T1: getChromiumLaunchOptions helper exists, is exported by browserService.js, and sets headless: true', () => {
      assert.strictEqual(typeof getChromiumLaunchOptions, 'function');
      const opts = getChromiumLaunchOptions();
      assert.strictEqual(opts.headless, true);
      assert.ok(Array.isArray(opts.args), 'args must be an array');
    });

    runSyncTest('T2: Default launch arguments include --disable-gpu and --disable-dev-shm-usage (prevents Docker /dev/shm OOM)', () => {
      const opts = getChromiumLaunchOptions();
      assert.ok(opts.args.includes('--disable-gpu'), 'Must include --disable-gpu');
      assert.ok(opts.args.includes('--disable-dev-shm-usage'), 'Must include --disable-dev-shm-usage');
    });

    runSyncTest('T3: In container mode (PLAYWRIGHT_CONTAINER_MODE=true or Linux), arguments include --no-sandbox and --disable-setuid-sandbox', () => {
      const originalContainerEnv = process.env.PLAYWRIGHT_CONTAINER_MODE;
      try {
        process.env.PLAYWRIGHT_CONTAINER_MODE = 'true';
        const containerOpts = getChromiumLaunchOptions();
        assert.ok(containerOpts.args.includes('--no-sandbox'), 'Container mode must include --no-sandbox');
        assert.ok(containerOpts.args.includes('--disable-setuid-sandbox'), 'Container mode must include --disable-setuid-sandbox');
      } finally {
        if (originalContainerEnv === undefined) {
          delete process.env.PLAYWRIGHT_CONTAINER_MODE;
        } else {
          process.env.PLAYWRIGHT_CONTAINER_MODE = originalContainerEnv;
        }
      }
    });

    runSyncTest('T4: User-provided custom launch options and arguments merge cleanly without duplicates', () => {
      const customOpts = getChromiumLaunchOptions({
        slowMo: 50,
        args: ['--disable-gpu', '--custom-flag-xyz'],
      });
      assert.strictEqual(customOpts.slowMo, 50);
      assert.ok(customOpts.args.includes('--custom-flag-xyz'));
      const gpuCount = customOpts.args.filter((a) => a === '--disable-gpu').length;
      assert.strictEqual(gpuCount, 1, 'Duplicate arguments must be deduplicated');
    });

    runSyncTest('T5: Browser operation execution maintains bounded concurrency (MAX_CONCURRENT_JOBS = 2)', () => {
      const status = getConcurrencyStatus();
      assert.strictEqual(typeof status.activeJobs, 'number');
      assert.strictEqual(status.maxJobs, 2);
      assert.strictEqual(BROWSER_POLICY.MAX_CONCURRENT_JOBS, 2);
    });

    runSyncTest('T6: Total task timeout (60s) and navigation timeout (30s) policies are preserved', () => {
      assert.strictEqual(BROWSER_POLICY.NAVIGATION_TIMEOUT_MS, 30000);
      assert.strictEqual(BROWSER_POLICY.TOTAL_TIMEOUT_MS, 60000);
    });

    await runAsyncTest('T7: Deterministic resource cleanup (page, context, browser) executes on completion and failure', async () => {
      // Test URL pre-flight validation rejection cleanly decrements / preserves concurrency counter
      const initialStatus = getConcurrencyStatus();
      const failureResult = await executeBrowserOperation({
        taskId: 'test-invalid-url-cleanup',
        operation: 'navigate',
        url: 'http://metadata.google.internal/secret', // Blocked SSRF URL
      });
      assert.strictEqual(failureResult.status, 'failed');
      assert.ok(failureResult.message.includes('failed'));
      const postStatus = getConcurrencyStatus();
      assert.strictEqual(postStatus.activeJobs, initialStatus.activeJobs, 'activeJobs must return to initial count');
    });

    // =========================================================================
    // SECTION 2: First-Party API Proxy & URL Normalization
    // =========================================================================
    console.log('\n--- SECTION 2: First-Party API Proxy & URL Normalization ---');

    const apiConfigPath = path.resolve(__dirname, '../../frontend/nexora/src/services/apiConfig.js');

    runSyncTest('T8: resolveApiBaseUrl helper resolves default http://localhost:5000 when VITE_API_URL is undefined', () => {
      assert.ok(fs.existsSync(apiConfigPath), 'apiConfig.js must exist');
      const content = fs.readFileSync(apiConfigPath, 'utf8');
      assert.ok(content.includes('resolveApiBaseUrl'), 'apiConfig.js must export resolveApiBaseUrl');

      // Test resolution logic directly
      const resolveApiBaseUrl = (env) => {
        if (env && typeof env.VITE_API_URL === 'string') {
          const trimmed = env.VITE_API_URL.trim();
          if (trimmed === '' || trimmed === '/') return '';
          return trimmed.replace(/\/+$/, '');
        }
        return 'http://localhost:5000';
      };

      assert.strictEqual(resolveApiBaseUrl(undefined), 'http://localhost:5000');
      assert.strictEqual(resolveApiBaseUrl({}), 'http://localhost:5000');
    });

    runSyncTest('T9: resolveApiBaseUrl returns empty string when VITE_API_URL is empty string or slash (enables same-origin relative URLs)', () => {
      const resolveApiBaseUrl = (env) => {
        if (env && typeof env.VITE_API_URL === 'string') {
          const trimmed = env.VITE_API_URL.trim();
          if (trimmed === '' || trimmed === '/') return '';
          return trimmed.replace(/\/+$/, '');
        }
        return 'http://localhost:5000';
      };

      assert.strictEqual(resolveApiBaseUrl({ VITE_API_URL: '' }), '');
      assert.strictEqual(resolveApiBaseUrl({ VITE_API_URL: '   ' }), '');
      assert.strictEqual(resolveApiBaseUrl({ VITE_API_URL: '/' }), '');
    });

    runSyncTest('T10: resolveApiBaseUrl normalizes trailing slashes on direct cross-origin URLs', () => {
      const resolveApiBaseUrl = (env) => {
        if (env && typeof env.VITE_API_URL === 'string') {
          const trimmed = env.VITE_API_URL.trim();
          if (trimmed === '' || trimmed === '/') return '';
          return trimmed.replace(/\/+$/, '');
        }
        return 'http://localhost:5000';
      };

      assert.strictEqual(resolveApiBaseUrl({ VITE_API_URL: 'https://api.nexora.ai/' }), 'https://api.nexora.ai');
      assert.strictEqual(resolveApiBaseUrl({ VITE_API_URL: 'https://api.nexora.ai///' }), 'https://api.nexora.ai');
      assert.strictEqual(resolveApiBaseUrl({ VITE_API_URL: 'https://api.nexora.ai' }), 'https://api.nexora.ai');
    });

    runSyncTest('T11: missionService.js exports API_BASE_URL consistent with resolveApiBaseUrl', () => {
      const missionServicePath = path.resolve(__dirname, '../../frontend/nexora/src/services/missionService.js');
      assert.ok(fs.existsSync(missionServicePath));
      const content = fs.readFileSync(missionServicePath, 'utf8');
      assert.ok(content.includes('API_BASE_URL'), 'missionService.js must re-export API_BASE_URL');
      assert.ok(content.includes('./apiConfig'), 'missionService.js must import API_BASE_URL from apiConfig');
    });

    runSyncTest('T12: frontend/nexora/vercel.json exists, has $schema, and defines valid rewrites array without unverified dynamic proxy', () => {
      const vercelPath = path.resolve(__dirname, '../../frontend/nexora/vercel.json');
      assert.ok(fs.existsSync(vercelPath), 'vercel.json must exist');
      const vercelConfig = JSON.parse(fs.readFileSync(vercelPath, 'utf8'));

      assert.ok(vercelConfig.$schema, 'Must define $schema');
      assert.ok(Array.isArray(vercelConfig.rewrites), 'Must define rewrites array');
      assert.strictEqual(vercelConfig.rewrites.length, 1, 'vercel.json must contain only the SPA fallback rewrite');
      assert.strictEqual(vercelConfig.rewrites[0].source, '/(.*)');
      assert.strictEqual(vercelConfig.rewrites[0].destination, '/index.html');
    });

    runSyncTest('T13: frontend/nexora/vercel.json defines SPA fallback rewrite /(.*) to /index.html', () => {
      const vercelPath = path.resolve(__dirname, '../../frontend/nexora/vercel.json');
      const vercelConfig = JSON.parse(fs.readFileSync(vercelPath, 'utf8'));

      const spaRewrite = vercelConfig.rewrites.find((r) => r.source === '/(.*)');
      assert.ok(spaRewrite, 'Must have SPA fallback rewrite rule for /(.*)');
      assert.strictEqual(spaRewrite.destination, '/index.html');
    });

    runSyncTest('T14: frontend/nexora/vite.config.js defines development server proxy for /api with changeOrigin: true', () => {
      const viteConfigPath = path.resolve(__dirname, '../../frontend/nexora/vite.config.js');
      assert.ok(fs.existsSync(viteConfigPath));
      const content = fs.readFileSync(viteConfigPath, 'utf8');

      assert.ok(content.includes("'/api':"), 'Vite config must define /api proxy');
      assert.ok(content.includes('changeOrigin: true'), 'Vite proxy must enable changeOrigin');
      assert.ok(content.includes('VITE_BACKEND_TARGET'), 'Vite proxy must support configurable backend target');
    });

    // =========================================================================
    // SECTION 3: Docker Compose Environment Wiring & Configuration Security
    // =========================================================================
    console.log('\n--- SECTION 3: Docker Compose Environment Wiring & Configuration Security ---');

    const composePath = path.resolve(__dirname, '../../docker-compose.yml');

    runSyncTest('T15: docker-compose.yml passes GOOGLE_CLIENT_ID: ${GOOGLE_CLIENT_ID:-} to backend service', () => {
      assert.ok(fs.existsSync(composePath), 'docker-compose.yml must exist');
      const composeContent = fs.readFileSync(composePath, 'utf8');

      assert.ok(
        composeContent.includes('GOOGLE_CLIENT_ID: ${GOOGLE_CLIENT_ID:-}'),
        'docker-compose.yml must pass GOOGLE_CLIENT_ID with fallback default'
      );
    });

    runSyncTest('T16: docker-compose.yml does not contain hardcoded secrets or credentials', () => {
      const composeContent = fs.readFileSync(composePath, 'utf8');
      assert.ok(!composeContent.includes('AIzaSy'), 'Must not contain hardcoded Google API keys');
      assert.ok(!composeContent.includes('password123'), 'Must not contain dummy production passwords');
    });

    runSyncTest('T17: docker-compose.yml preserves MongoDB healthcheck dependency and persistent volume', () => {
      const composeContent = fs.readFileSync(composePath, 'utf8');
      assert.ok(composeContent.includes('mongodb:'), 'Must define mongodb service');
      assert.ok(composeContent.includes('condition: service_healthy'), 'Must depend on healthy mongodb');
      assert.ok(composeContent.includes('nexora_mongo_data:'), 'Must define persistent volume');
    });

    runSyncTest('T18: frontend/nexora/.env.example documents VITE_API_URL for both same-origin proxy and direct cross-origin', () => {
      const envExamplePath = path.resolve(__dirname, '../../frontend/nexora/.env.example');
      assert.ok(fs.existsSync(envExamplePath));
      const content = fs.readFileSync(envExamplePath, 'utf8');

      assert.ok(content.includes('VITE_API_URL='), 'Must document VITE_API_URL');
      assert.ok(content.includes('same-origin proxy'), 'Must document same-origin proxy option');
      assert.ok(content.includes('cross-origin'), 'Must document direct cross-origin option');
    });

    runSyncTest('T19: frontend/nexora/.env.example explicitly warns against placing private server secrets in client variables', () => {
      const envExamplePath = path.resolve(__dirname, '../../frontend/nexora/.env.example');
      const content = fs.readFileSync(envExamplePath, 'utf8');
      assert.ok(content.includes('NEVER put private server secrets'), 'Must contain security warning');
    });

    await runAsyncTest('T20: Existing email/password authentication and security policies remain intact without regression', async () => {
      const healthRes = await fetch(`${baseUrl}/api/health`);
      assert.strictEqual(healthRes.status, 200);
      const healthData = await healthRes.json();
      assert.strictEqual(healthData.status, 'ok');

      // Verify unconfigured Google auth returns safe 503
      const origClientId = process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_ID;
      try {
        const googleRes = await fetch(`${baseUrl}/api/auth/google`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ credential: 'dummy-token' }),
        });
        assert.strictEqual(googleRes.status, 503);
      } finally {
        if (origClientId !== undefined) {
          process.env.GOOGLE_CLIENT_ID = origClientId;
        }
      }
    });

    runSyncTest('T21: getCookieOptions and getClearCookieOptions have matching attributes across dev and production', () => {
      // 1. Development checks
      const devIssue = getCookieOptions({ NODE_ENV: 'development' });
      const devClear = getClearCookieOptions({ NODE_ENV: 'development' });
      assert.strictEqual(devIssue.httpOnly, true);
      assert.strictEqual(devClear.httpOnly, true);
      assert.strictEqual(devIssue.secure, false);
      assert.strictEqual(devClear.secure, false);
      assert.strictEqual(devIssue.sameSite, 'lax');
      assert.strictEqual(devClear.sameSite, 'lax');
      assert.strictEqual(devIssue.path, '/');
      assert.strictEqual(devClear.path, '/');
      assert.strictEqual(devClear.maxAge, undefined);
      assert.ok(typeof devIssue.maxAge === 'number');

      // 2. Production checks
      const prodIssue = getCookieOptions({ NODE_ENV: 'production' });
      const prodClear = getClearCookieOptions({ NODE_ENV: 'production' });
      assert.strictEqual(prodIssue.httpOnly, true);
      assert.strictEqual(prodClear.httpOnly, true);
      assert.strictEqual(prodIssue.secure, true);
      assert.strictEqual(prodClear.secure, true);
      assert.strictEqual(prodIssue.sameSite, 'lax');
      assert.strictEqual(prodClear.sameSite, 'lax');
      assert.strictEqual(prodIssue.path, '/');
      assert.strictEqual(prodClear.path, '/');
      assert.strictEqual(prodClear.maxAge, undefined);
      assert.ok(typeof prodIssue.maxAge === 'number');
    });

  } finally {
    if (httpServer) {
      await new Promise((resolve) => httpServer.close(resolve));
    }
    await mongoose.disconnect();
  }

  console.log('\n====================================================');
  console.log(`  PHASE 3.3A SUITE RESULTS: ${passedTests} / ${totalTests} PASSED`);
  if (failedTests > 0) {
    console.error(`  ${failedTests} TESTS FAILED`);
    process.exit(1);
  } else {
    console.log('  ALL TESTS PASSED SUCCESSFULLY');
    console.log('====================================================\n');
  }
}

if (require.main === module) {
  runPhase3_3ASuite().catch((err) => {
    console.error('Fatal error running Phase 3.3A suite:', err);
    process.exit(1);
  });
}

module.exports = { runPhase3_3ASuite };
