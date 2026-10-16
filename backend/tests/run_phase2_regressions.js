const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// 1. Load baseline environment if available
const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath) && typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile(envPath);
  } catch {}
}

// 2. Resolve and strictly validate dedicated test database
const DEFAULT_TEST_DB_URI = 'mongodb://127.0.0.1:27017/nexora_test';
const rawTestDbUri = process.env.MONGODB_TEST_URI || process.env.TEST_MONGODB_URI || DEFAULT_TEST_DB_URI;

/**
 * Validates that the targeted MongoDB URI points to a safe, isolated test database.
 * Strictly prevents running destructive cleanup against the user's development or production database.
 *
 * @param {string} uri
 * @returns {string} The validated URI
 */
function validateTestDatabaseUri(uri) {
  if (!uri || typeof uri !== 'string') {
    throw new Error('[TEST DATABASE SAFETY ERROR] Test database URI must be a valid non-empty string.');
  }

  const cleanUri = uri.trim();
  let dbName = '';
  try {
    const parsed = new URL(
      cleanUri.startsWith('mongodb://') || cleanUri.startsWith('mongodb+srv://')
        ? cleanUri
        : `mongodb://${cleanUri}`
    );
    dbName = (parsed.pathname || '').replace(/^\//, '').toLowerCase();
  } catch (err) {
    throw new Error(`[TEST DATABASE SAFETY ERROR] Malformed MongoDB URI: ${cleanUri}`);
  }

  // Strictly forbid targeting user's development DB ('nexora'), production, or system DBs
  const FORBIDDEN_EXACT_NAMES = new Set(['nexora', 'production', 'admin', 'local', 'config']);
  if (!dbName || FORBIDDEN_EXACT_NAMES.has(dbName) || !dbName.includes('test')) {
    throw new Error(
      `[TEST DATABASE SAFETY ERROR] Destructive test execution blocked!\n` +
      `Target database "${dbName}" is not an isolated test database.\n` +
      `Safety rule: Test database name must contain "test" (e.g. "nexora_test") and cannot be the active development database ("nexora") or production database.\n` +
      `Configure MONGODB_TEST_URI=mongodb://127.0.0.1:27017/nexora_test to proceed.`
    );
  }

  return { uri: cleanUri, dbName };
}

const { uri: validatedTestDbUri, dbName: testDbName } = validateTestDatabaseUri(rawTestDbUri);

// Enforce test environment variables globally for test runner
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = validatedTestDbUri;

const suites = [
  'verify_step8g3.js',
  'verify_step8g4.js',
  'verify_step8g5.js',
  'verify_step8g6.js',
  'verify_step8g6_p1.js',
  'verify_step8g6_p2_2.js',
  'verify_step8g6_p2_3.js',
  'verify_step8g6_p2_4.js',
  'verify_step8g6_p2_5.js',
  'verify_step8g6_p2_6.js',
  'verify_step8g6_p2_7.js',
  'verify_step8g6_p2_8.js',
  'verify_step8g6_p2_9.js',
  'verify_step8g6_p2_10.js',
  'verify_step8g6_p2_11.js',
  'verify_step8g6_p2_12.js',
  'verify_step8g6_p2_13.js',
  'verify_step8g6_p2_14.js',
  'verify_step8g6_p2_15.js',
  'verify_security_hardening.js',
];

const results = [];

async function runAll() {
  console.log('========================================================================');
  console.log(`RUNNING FULL REGRESSION SUITES (${suites.length} SUITES)`);
  console.log(`[TEST ISOLATION] Target Database: ${testDbName} (${validatedTestDbUri})`);
  console.log('========================================================================\n');

  for (const suite of suites) {
    const filePath = path.join(__dirname, suite);
    console.log(`\n========================================\nRUNNING: ${suite}\n========================================`);

    // Clean up dedicated test DB before each suite for test isolation
    try {
      execSync(
        `node -e "const mongoose = require('mongoose'); const uri = '${validatedTestDbUri}'; (async () => { await mongoose.connect(uri); await mongoose.connection.collection('missiontasks').deleteMany({}); await mongoose.connection.collection('missions').deleteMany({}); await mongoose.connection.collection('missiontelemetries').deleteMany({}); await mongoose.connection.collection('missionevents').deleteMany({}); await mongoose.disconnect(); })();"`,
        { stdio: 'ignore' }
      );
    } catch (cleanupErr) {
      console.warn(`[TEST ISOLATION] Note: Pre-suite cleanup encountered non-fatal error: ${cleanupErr.message}`);
    }

    // Brief breather between suites for complete OS socket/process teardown
    await new Promise((r) => setTimeout(r, 1500));
    const startTime = Date.now();
    try {
      const stdout = execSync(`node "${filePath}"`, {
        encoding: 'utf8',
        timeout: 180000,
        env: {
          ...process.env,
          NODE_ENV: 'test',
          MONGODB_URI: validatedTestDbUri,
        },
      });
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);

      const match =
        stdout.match(/(\d+)\s*\/\s*(\d+)\s+PASSED/i) ||
        stdout.match(/(\d+)\s*\/\s*(\d+)\s+passed/i) ||
        stdout.match(/PASSED:\s*(\d+)\s*\/\s*(\d+)/i) ||
        stdout.match(/(\d+)\s+passed,\s+(\d+)\s+failed/i);

      console.log(stdout);
      console.log(`[COMPLETED] ${suite} in ${duration}s`);
      results.push({ suite, success: true, duration, match: match ? match[0] : 'PASS' });
    } catch (err) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      console.error(`[FAILED] ${suite} failed after ${duration}s:\n`, err.stdout || err.message);
      results.push({ suite, success: false, duration, error: err.message });
    }
  }

  console.log('\n========================================================================');
  console.log('CUMULATIVE REGRESSION SUMMARY');
  console.log('========================================================================');
  for (const r of results) {
    console.log(`${r.suite.padEnd(26)} | ${r.success ? 'PASS' : 'FAIL'} (${r.duration}s) | ${r.match || r.error || ''}`);
  }
  const allPassed = results.every((r) => r.success);
  console.log(`\nOVERALL: ${allPassed ? 'ALL SUITES PASSED (100%)' : 'SOME SUITES FAILED'}`);
  process.exit(allPassed ? 0 : 1);
}

runAll();
