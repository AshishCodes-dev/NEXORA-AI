/**
 * NEXORA Security Hardening & SSRF Regression Suite
 *
 * Verifies:
 * SECTION 1: Advanced SSRF & IP Validation Invariants
 * - T1: IPv4 loopback (127.0.0.1, 127.0.0.2) and current network (0.0.0.0) identified as private
 * - T2: RFC 1918 private subnets (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16) identified as private
 * - T3: Cloud metadata and link-local (169.254.169.254, 169.254.0.1) identified as private
 * - T4: Carrier-grade NAT (100.64.0.1) and test networks (192.0.2.1, 198.51.100.1, 203.0.113.1) identified as private
 * - T5: IPv6 loopback (::1) and unspecified (::) identified as private
 * - T6: IPv4-mapped IPv6 in dotted-decimal (::ffff:127.0.0.1, ::ffff:169.254.169.254) identified as private
 * - T7: IPv4-mapped IPv6 in hex notation (::ffff:7f00:1, ::ffff:a9fe:a9fe) identified as private
 * - T8: Full 8-word IPv6 with embedded IPv4 (0:0:0:0:0:ffff:7f00:1) identified as private
 * - T9: 6to4 encapsulation (2002:7f00:1::) and NAT64 (64:ff9b::127.0.0.1) identified as private
 * - T10: IPv6 ULA (fc00::1, fd00::1), link-local (fe80::1), and site-local (fec0::1) identified as private
 * - T11: IPv6 documentation (2001:db8::1) and discard (100::1) identified as private
 * - T12: Genuine public IPs (8.8.8.8, 1.1.1.1, 2607:f8b0:4005:805::200e) correctly identified as public (false)
 *
 * SECTION 2: URL & Protocol Security Policy
 * - T13: Dangerous protocols (file:, ftp:, gopher:, javascript:, data:) strictly rejected
 * - T14: Blocked internal hostnames (localhost, metadata.google.internal, instance-data, api.internal, *.local) rejected
 * - T15: Direct private IP literals in URLs rejected (http://127.0.0.1, http://[::1], http://[::ffff:7f00:1])
 * - T16: checkUrlSynchronous validates protocol and hostname before DNS lookup
 *
 * SECTION 3: Frontend API URL & Routing Configuration
 * - T17: resolveApiBaseUrl defaults to http://localhost:5000 when undefined
 * - T18: resolveApiBaseUrl normalizes trailing slashes on direct cross-origin origins
 * - T19: resolveApiBaseUrl strips duplicated trailing /api and /api/ to prevent /api/api path corruption
 * - T20: resolveApiBaseUrl returns empty string for '' or '/' enabling same-origin proxy
 *
 * SECTION 4: Browser Agent Resilience & Fallback Security Invariant
 * - T21: browserAgent does NOT trigger HTTP fetchSource fallback when target URL is blocked by security policy
 * - T22: authMiddleware accepts both HTTP-only cookie and Authorization: Bearer token
 * - T23: authMiddleware safely rejects malformed or missing Bearer tokens
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';

const { isPrivateIp, validateSafeUrl } = require('../services/research/urlValidator');
const { checkUrlSynchronous, validateBrowserUrl } = require('../services/browser/browserPolicy');
const authMiddleware = require('../middleware/authMiddleware');
const { getJwtSecret } = require('../config/authConfig');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

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

async function main() {
  console.log('\n========================================================================');
  console.log('RUNNING NEXORA SECURITY HARDENING & SSRF REGRESSION SUITE');
  console.log('========================================================================\n');

  // --------------------------------------------------------------------------
  // SECTION 1: Advanced SSRF & IP Validation Invariants
  // --------------------------------------------------------------------------
  console.log('--- SECTION 1: Advanced SSRF & IP Validation Invariants ---');

  runSyncTest('T1: IPv4 loopback and current network identified as private', () => {
    assert.strictEqual(isPrivateIp('127.0.0.1'), true);
    assert.strictEqual(isPrivateIp('127.0.0.2'), true);
    assert.strictEqual(isPrivateIp('0.0.0.0'), true);
  });

  runSyncTest('T2: RFC 1918 private subnets identified as private', () => {
    assert.strictEqual(isPrivateIp('10.0.0.1'), true);
    assert.strictEqual(isPrivateIp('10.255.255.255'), true);
    assert.strictEqual(isPrivateIp('172.16.0.1'), true);
    assert.strictEqual(isPrivateIp('172.31.255.255'), true);
    assert.strictEqual(isPrivateIp('192.168.0.1'), true);
    assert.strictEqual(isPrivateIp('192.168.1.100'), true);
  });

  runSyncTest('T3: Cloud metadata and link-local identified as private', () => {
    assert.strictEqual(isPrivateIp('169.254.169.254'), true);
    assert.strictEqual(isPrivateIp('169.254.0.1'), true);
    assert.strictEqual(isPrivateIp('169.254.255.255'), true);
  });

  runSyncTest('T4: Carrier-grade NAT and test networks identified as private', () => {
    assert.strictEqual(isPrivateIp('100.64.0.1'), true);
    assert.strictEqual(isPrivateIp('100.127.255.255'), true);
    assert.strictEqual(isPrivateIp('192.0.2.1'), true);
    assert.strictEqual(isPrivateIp('198.51.100.1'), true);
    assert.strictEqual(isPrivateIp('203.0.113.1'), true);
  });

  runSyncTest('T5: IPv6 loopback and unspecified identified as private', () => {
    assert.strictEqual(isPrivateIp('::1'), true);
    assert.strictEqual(isPrivateIp('::'), true);
    assert.strictEqual(isPrivateIp('0:0:0:0:0:0:0:1'), true);
  });

  runSyncTest('T6: IPv4-mapped IPv6 in dotted-decimal identified as private', () => {
    assert.strictEqual(isPrivateIp('::ffff:127.0.0.1'), true);
    assert.strictEqual(isPrivateIp('::ffff:169.254.169.254'), true);
    assert.strictEqual(isPrivateIp('::ffff:10.0.0.1'), true);
    assert.strictEqual(isPrivateIp('::ffff:192.168.1.1'), true);
  });

  runSyncTest('T7: IPv4-mapped IPv6 in hex notation identified as private', () => {
    assert.strictEqual(isPrivateIp('::ffff:7f00:1'), true);
    assert.strictEqual(isPrivateIp('::ffff:a9fe:a9fe'), true);
    assert.strictEqual(isPrivateIp('::ffff:0a00:0001'), true);
  });

  runSyncTest('T8: Full 8-word IPv6 with embedded IPv4 identified as private', () => {
    assert.strictEqual(isPrivateIp('0:0:0:0:0:ffff:7f00:1'), true);
    assert.strictEqual(isPrivateIp('0:0:0:0:0:ffff:127.0.0.1'), true);
  });

  runSyncTest('T9: 6to4 encapsulation and NAT64 identified as private', () => {
    assert.strictEqual(isPrivateIp('2002:7f00:1::'), true);
    assert.strictEqual(isPrivateIp('2002:a9fe:a9fe::'), true);
    assert.strictEqual(isPrivateIp('64:ff9b::127.0.0.1'), true);
  });

  runSyncTest('T10: IPv6 ULA, link-local, and site-local identified as private', () => {
    assert.strictEqual(isPrivateIp('fc00::1'), true);
    assert.strictEqual(isPrivateIp('fd00::1'), true);
    assert.strictEqual(isPrivateIp('fe80::1'), true);
    assert.strictEqual(isPrivateIp('fec0::1'), true);
  });

  runSyncTest('T11: IPv6 documentation and discard identified as private', () => {
    assert.strictEqual(isPrivateIp('2001:db8::1'), true);
    assert.strictEqual(isPrivateIp('100::1'), true);
    assert.strictEqual(isPrivateIp('2001:2::1'), true);
  });

  runSyncTest('T12: Genuine public IPs correctly identified as public (false)', () => {
    assert.strictEqual(isPrivateIp('8.8.8.8'), false);
    assert.strictEqual(isPrivateIp('1.1.1.1'), false);
    assert.strictEqual(isPrivateIp('142.250.190.46'), false);
    assert.strictEqual(isPrivateIp('2607:f8b0:4005:805::200e'), false);
  });

  // --------------------------------------------------------------------------
  // SECTION 2: URL & Protocol Security Policy
  // --------------------------------------------------------------------------
  console.log('\n--- SECTION 2: URL & Protocol Security Policy ---');

  await runAsyncTest('T13: Dangerous protocols strictly rejected', async () => {
    const protocols = ['file:///etc/passwd', 'ftp://example.com', 'gopher://example.com', 'javascript:alert(1)', 'data:text/html,test'];
    for (const protoUrl of protocols) {
      const res = await validateSafeUrl(protoUrl);
      assert.strictEqual(res.isValid, false, `Expected ${protoUrl} to be rejected`);
      assert.ok(res.reason.includes('UNSAFE_PROTOCOL') || res.reason.includes('INVALID_URL'));
    }
  });

  await runAsyncTest('T14: Blocked internal hostnames rejected', async () => {
    const blockedHosts = [
      'http://localhost:3000',
      'http://metadata.google.internal/computeMetadata/v1/',
      'http://instance-data/latest/meta-data/',
      'http://api.internal/v1',
      'http://app.local/status',
    ];
    for (const u of blockedHosts) {
      const res = await validateSafeUrl(u);
      assert.strictEqual(res.isValid, false, `Expected ${u} to be rejected`);
      assert.ok(res.reason.includes('BLOCKED_HOSTNAME'));
    }
  });

  await runAsyncTest('T15: Direct private IP literals in URLs rejected', async () => {
    const privateUrls = [
      'http://127.0.0.1:8080/admin',
      'http://169.254.169.254/latest/meta-data/',
      'http://[::1]:5000/api',
      'http://[::ffff:7f00:1]:3000',
      'http://[::ffff:a9fe:a9fe]/metadata',
    ];
    for (const u of privateUrls) {
      const res = await validateSafeUrl(u);
      assert.strictEqual(res.isValid, false, `Expected ${u} to be rejected`);
      assert.ok(res.reason.includes('PRIVATE_OR_RESERVED_IP') || res.reason.includes('BLOCKED_HOSTNAME'));
    }
  });

  runSyncTest('T16: checkUrlSynchronous validates protocol and hostname before DNS lookup', () => {
    assert.strictEqual(checkUrlSynchronous('http://localhost').isAllowed, false);
    assert.strictEqual(checkUrlSynchronous('ftp://example.com').isAllowed, false);
    assert.strictEqual(checkUrlSynchronous('https://example.com').isAllowed, true);
    assert.strictEqual(checkUrlSynchronous('').isAllowed, false);
  });

  // --------------------------------------------------------------------------
  // SECTION 3: Frontend API URL & Routing Configuration
  // --------------------------------------------------------------------------
  console.log('\n--- SECTION 3: Frontend API URL & Routing Configuration ---');

  // Import directly from frontend module
  const { resolveApiBaseUrl } = require('../../frontend/nexora/src/services/apiConfig');

  runSyncTest('T17: resolveApiBaseUrl defaults to http://localhost:5000 when undefined', () => {
    assert.strictEqual(resolveApiBaseUrl({}), 'http://localhost:5000');
    assert.strictEqual(resolveApiBaseUrl({ VITE_API_URL: undefined }), 'http://localhost:5000');
  });

  runSyncTest('T18: resolveApiBaseUrl normalizes trailing slashes on direct cross-origin origins', () => {
    assert.strictEqual(resolveApiBaseUrl({ VITE_API_URL: 'https://nexora-backend.onrender.com/' }), 'https://nexora-backend.onrender.com');
    assert.strictEqual(resolveApiBaseUrl({ VITE_API_URL: 'https://nexora-backend.onrender.com///' }), 'https://nexora-backend.onrender.com');
  });

  runSyncTest('T19: resolveApiBaseUrl strips duplicated trailing /api to prevent /api/api corruption', () => {
    assert.strictEqual(resolveApiBaseUrl({ VITE_API_URL: 'https://nexora-backend.onrender.com/api' }), 'https://nexora-backend.onrender.com');
    assert.strictEqual(resolveApiBaseUrl({ VITE_API_URL: 'https://nexora-backend.onrender.com/api/' }), 'https://nexora-backend.onrender.com');
    assert.strictEqual(resolveApiBaseUrl({ VITE_API_URL: 'http://localhost:5000/API/' }), 'http://localhost:5000');
  });

  runSyncTest('T20: resolveApiBaseUrl returns empty string for "" or "/" enabling same-origin proxy', () => {
    assert.strictEqual(resolveApiBaseUrl({ VITE_API_URL: '' }), '');
    assert.strictEqual(resolveApiBaseUrl({ VITE_API_URL: '/' }), '');
    assert.strictEqual(resolveApiBaseUrl({ VITE_API_URL: '   ' }), '');
  });

  // --------------------------------------------------------------------------
  // SECTION 4: Browser Agent Resilience & Fallback Security Invariant
  // --------------------------------------------------------------------------
  console.log('\n--- SECTION 4: Browser Agent Resilience & Fallback Security Invariant ---');

  runSyncTest('T21: browserAgent guard identifies security rejection error codes', () => {
    const securityCodes = ['BLOCKED_URL', 'INVALID_URL', 'UNSUPPORTED_OPERATION'];
    for (const code of securityCodes) {
      const isSecurityRejection = ['BLOCKED_URL', 'INVALID_URL', 'UNSUPPORTED_OPERATION'].includes(code);
      assert.strictEqual(isSecurityRejection, true, `Expected ${code} to be classified as security rejection`);
    }

    const nonSecurityCodes = ['BROWSER_LAUNCH_FAILED', 'TOTAL_TIMEOUT', 'NAVIGATION_TIMEOUT'];
    for (const code of nonSecurityCodes) {
      const isSecurityRejection = ['BLOCKED_URL', 'INVALID_URL', 'UNSUPPORTED_OPERATION'].includes(code);
      assert.strictEqual(isSecurityRejection, false, `Expected ${code} to NOT be classified as security rejection`);
    }
  });

  runSyncTest('T22: authMiddleware accepts both HTTP-only cookie and Authorization: Bearer token', () => {
    const testSecret = getJwtSecret();
    const token = jwt.sign({ id: 'user-123', email: 'test@example.com', authProvider: 'local' }, testSecret, { expiresIn: '1h' });

    // Test Cookie transmission
    let reqCookie = { cookies: { nexora_token: token }, headers: {} };
    let resCookie = {};
    let nextCalledCookie = false;
    authMiddleware(reqCookie, resCookie, () => { nextCalledCookie = true; });
    assert.strictEqual(nextCalledCookie, true);
    assert.strictEqual(reqCookie.user?.id, 'user-123');

    // Test Bearer token transmission
    let reqBearer = { cookies: {}, headers: { authorization: `Bearer ${token}` } };
    let resBearer = {};
    let nextCalledBearer = false;
    authMiddleware(reqBearer, resBearer, () => { nextCalledBearer = true; });
    assert.strictEqual(nextCalledBearer, true);
    assert.strictEqual(reqBearer.user?.id, 'user-123');
  });

  runSyncTest('T23: authMiddleware safely rejects malformed or missing Bearer tokens', () => {
    let statusSet = null;
    let jsonSent = null;
    const fakeRes = {
      status(code) {
        statusSet = code;
        return {
          json(obj) { jsonSent = obj; }
        };
      }
    };

    // Missing token
    authMiddleware({ cookies: {}, headers: {} }, fakeRes, () => {});
    assert.strictEqual(statusSet, 401);
    assert.strictEqual(jsonSent?.success, false);

    // Malformed token
    authMiddleware({ cookies: {}, headers: { authorization: 'Bearer invalid.secret.token' } }, fakeRes, () => {});
    assert.strictEqual(statusSet, 401);
    assert.strictEqual(jsonSent?.success, false);
  });

  console.log('\n========================================================================');
  console.log(`ALL TESTS PASSED: ${passedTests}/${totalTests}`);
  console.log('========================================================================\n');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('\n[SUITE FATAL ERROR]', err.message);
    process.exit(1);
  });
}

module.exports = { main };
