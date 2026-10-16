/**
 * NEXORA Phase 3.2 Verification Suite
 * Step 8G.6 Phase 2.14 — Google Authentication & Staging-Readiness Verification
 *
 * Verifies:
 * SECTION 1: Schema & Security Configuration
 * - T1: User schema defines googleId with partialFilterExpression unique index
 * - T2: User schema preserves firebaseUid for backwards compatibility
 * - T3: getGoogleClientId correctly handles missing, whitespace, and valid configurations
 *
 * SECTION 2: Request Validation & Server Configuration Guards
 * - T4: POST /api/auth/google returns HTTP 503 when GOOGLE_CLIENT_ID is unconfigured
 * - T5: POST /api/auth/google returns HTTP 400 when credential token is missing or empty
 * - T6: POST /api/auth/google returns HTTP 400 when credential token is not a string
 *
 * SECTION 3: Token Verification & Cryptographic Claims Validation
 * - T7: Token verification failure (signature mismatch/expired) returns HTTP 401
 * - T8: Token with missing or non-object payload returns HTTP 401
 * - T9: Token missing required 'sub' claim returns HTTP 401
 * - T10: Token missing required 'email' claim returns HTTP 401
 * - T11: Token with invalid issuer returns HTTP 401
 * - T12: Token with audience mismatch returns HTTP 401
 * - T13: Token with unverified email (email_verified: false) returns HTTP 401
 *
 * SECTION 4: User Provisioning, Account Linking & Collision Policies
 * - T14: Valid Google ID token provisions new user with googleId, null passwordHash, and google provider
 * - T15: Returns secure HTTP-only nexora_token session cookie and sanitized user profile
 * - T16: Repeat Google sign-in reuses existing user identity without duplicate creation
 * - T17: Google sign-in for email existing as password account safely conflicts (HTTP 409) and preserves password
 *
 * SECTION 5: End-to-End Regression & Environment Consistency
 * - T18: Standard email/password authentication functions without regression
 * - T19: Environment templates (backend & frontend) document Google client ID configurations
 * - T20: GoogleAuthButton component contract enforces disabled (COMING SOON) state when unconfigured
 */

const path = require('path');
const fs = require('fs');
const assert = require('assert');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

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
const { getGoogleClientId, COOKIE_NAME } = require('../config/authConfig');
const User = require('../models/User');
const { app } = require('../server');
const authRouter = require('../routes/authRoutes');

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

async function runPhase3_2Suite() {
  console.log('====================================================');
  console.log('  STARTING NEXORA PHASE 3.2 VERIFICATION SUITE');
  console.log('  Google Authentication & Staging-Readiness');
  console.log('====================================================\n');

  await connectDB();

  const createdUserIds = [];
  let httpServer = null;
  let baseUrl = '';

  const TEST_CLIENT_ID = 'test-google-client-id-12345.apps.googleusercontent.com';

  try {
    httpServer = await new Promise((resolve) => {
      const server = app.listen(0, () => resolve(server));
    });
    const port = httpServer.address().port;
    baseUrl = `http://127.0.0.1:${port}`;

    // =========================================================================
    // SECTION 1: Schema & Security Configuration
    // =========================================================================
    console.log('--- SECTION 1: Schema & Security Configuration ---');

    runSyncTest('T1: User schema defines googleId with partialFilterExpression unique index', () => {
      const googleIdPath = User.schema.paths.googleId;
      assert.ok(googleIdPath, 'googleId path must exist on User schema');
      assert.strictEqual(googleIdPath.instance, 'String');
      assert.strictEqual(googleIdPath.defaultValue, null);

      const indexes = User.schema.indexes();
      const googleIndex = indexes.find((idx) => idx[0] && idx[0].googleId === 1);
      assert.ok(googleIndex, 'Unique index for googleId must exist on User schema');
      assert.strictEqual(googleIndex[1].unique, true);
      assert.deepStrictEqual(googleIndex[1].partialFilterExpression, { googleId: { $type: 'string' } });
    });

    runSyncTest('T2: User schema preserves firebaseUid for backwards compatibility', () => {
      const firebasePath = User.schema.paths.firebaseUid;
      assert.ok(firebasePath, 'firebaseUid path must exist on User schema');
      assert.strictEqual(firebasePath.instance, 'String');
      assert.strictEqual(firebasePath.defaultValue, null);
    });

    runSyncTest('T3: getGoogleClientId correctly handles missing, whitespace, and valid configurations', () => {
      assert.strictEqual(getGoogleClientId({}), null);
      assert.strictEqual(getGoogleClientId({ GOOGLE_CLIENT_ID: '' }), null);
      assert.strictEqual(getGoogleClientId({ GOOGLE_CLIENT_ID: '   ' }), null);
      assert.strictEqual(
        getGoogleClientId({ GOOGLE_CLIENT_ID: '  my-test-client-id.apps.googleusercontent.com  ' }),
        'my-test-client-id.apps.googleusercontent.com'
      );
    });

    // =========================================================================
    // SECTION 2: Request Validation & Server Configuration Guards
    // =========================================================================
    console.log('\n--- SECTION 2: Request Validation & Server Configuration Guards ---');

    await runAsyncTest('T4: POST /api/auth/google returns HTTP 503 when GOOGLE_CLIENT_ID is unconfigured', async () => {
      const originalClientId = process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_ID;

      try {
        const res = await fetch(`${baseUrl}/api/auth/google`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ credential: 'dummy-token' }),
        });
        const data = await res.json();
        assert.strictEqual(res.status, 503);
        assert.strictEqual(data.success, false);
        assert.match(data.message, /not configured/i);
      } finally {
        if (originalClientId !== undefined) {
          process.env.GOOGLE_CLIENT_ID = originalClientId;
        } else {
          process.env.GOOGLE_CLIENT_ID = TEST_CLIENT_ID;
        }
      }
    });

    // Ensure GOOGLE_CLIENT_ID is set for subsequent tests
    process.env.GOOGLE_CLIENT_ID = TEST_CLIENT_ID;

    await runAsyncTest('T5: POST /api/auth/google returns HTTP 400 when credential token is missing or empty', async () => {
      const res1 = await fetch(`${baseUrl}/api/auth/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data1 = await res1.json();
      assert.strictEqual(res1.status, 400);
      assert.strictEqual(data1.success, false);
      assert.match(data1.message, /credential token is required/i);

      const res2 = await fetch(`${baseUrl}/api/auth/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: '   ' }),
      });
      const data2 = await res2.json();
      assert.strictEqual(res2.status, 400);
      assert.strictEqual(data2.success, false);
    });

    await runAsyncTest('T6: POST /api/auth/google returns HTTP 400 when credential token is not a string', async () => {
      const res = await fetch(`${baseUrl}/api/auth/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: { token: 'invalid-object' } }),
      });
      const data = await res.json();
      assert.strictEqual(res.status, 400);
      assert.strictEqual(data.success, false);
    });

    // =========================================================================
    // SECTION 3: Token Verification & Cryptographic Claims Validation
    // =========================================================================
    console.log('\n--- SECTION 3: Token Verification & Cryptographic Claims Validation ---');

    await runAsyncTest('T7: Token verification failure (signature mismatch/expired) returns HTTP 401', async () => {
      authRouter.setGoogleTokenVerifierForTesting(async () => {
        throw new Error('Token used too early or signature verification failed');
      });

      try {
        const res = await fetch(`${baseUrl}/api/auth/google`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ credential: 'bad-signature-token' }),
        });
        const data = await res.json();
        assert.strictEqual(res.status, 401);
        assert.strictEqual(data.success, false);
        assert.match(data.message, /invalid or expired/i);
      } finally {
        authRouter.resetGoogleTokenVerifierForTesting();
      }
    });

    await runAsyncTest('T8: Token with missing or non-object payload returns HTTP 401', async () => {
      authRouter.setGoogleTokenVerifierForTesting(async () => null);

      try {
        const res = await fetch(`${baseUrl}/api/auth/google`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ credential: 'null-payload-token' }),
        });
        const data = await res.json();
        assert.strictEqual(res.status, 401);
        assert.strictEqual(data.success, false);
        assert.match(data.message, /invalid google token payload/i);
      } finally {
        authRouter.resetGoogleTokenVerifierForTesting();
      }
    });

    await runAsyncTest('T9: Token missing required sub claim returns HTTP 401', async () => {
      authRouter.setGoogleTokenVerifierForTesting(async () => ({
        email: 'nosub@nexora.ai',
        email_verified: true,
        iss: 'accounts.google.com',
        aud: TEST_CLIENT_ID,
      }));

      try {
        const res = await fetch(`${baseUrl}/api/auth/google`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ credential: 'no-sub-token' }),
        });
        const data = await res.json();
        assert.strictEqual(res.status, 401);
        assert.strictEqual(data.success, false);
        assert.match(data.message, /subject claim/i);
      } finally {
        authRouter.resetGoogleTokenVerifierForTesting();
      }
    });

    await runAsyncTest('T10: Token missing required email claim returns HTTP 401', async () => {
      authRouter.setGoogleTokenVerifierForTesting(async () => ({
        sub: 'google-sub-12345',
        email_verified: true,
        iss: 'accounts.google.com',
        aud: TEST_CLIENT_ID,
      }));

      try {
        const res = await fetch(`${baseUrl}/api/auth/google`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ credential: 'no-email-token' }),
        });
        const data = await res.json();
        assert.strictEqual(res.status, 401);
        assert.strictEqual(data.success, false);
        assert.match(data.message, /email claim/i);
      } finally {
        authRouter.resetGoogleTokenVerifierForTesting();
      }
    });

    await runAsyncTest('T11: Token with invalid issuer returns HTTP 401', async () => {
      authRouter.setGoogleTokenVerifierForTesting(async () => ({
        sub: 'google-sub-12345',
        email: 'attacker@evil.com',
        email_verified: true,
        iss: 'https://evil.issuer.com',
        aud: TEST_CLIENT_ID,
      }));

      try {
        const res = await fetch(`${baseUrl}/api/auth/google`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ credential: 'bad-issuer-token' }),
        });
        const data = await res.json();
        assert.strictEqual(res.status, 401);
        assert.strictEqual(data.success, false);
        assert.match(data.message, /issuer/i);
      } finally {
        authRouter.resetGoogleTokenVerifierForTesting();
      }
    });

    await runAsyncTest('T12: Token with audience mismatch returns HTTP 401', async () => {
      authRouter.setGoogleTokenVerifierForTesting(async () => ({
        sub: 'google-sub-12345',
        email: 'user@nexora.ai',
        email_verified: true,
        iss: 'https://accounts.google.com',
        aud: 'different-app.apps.googleusercontent.com',
      }));

      try {
        const res = await fetch(`${baseUrl}/api/auth/google`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ credential: 'aud-mismatch-token' }),
        });
        const data = await res.json();
        assert.strictEqual(res.status, 401);
        assert.strictEqual(data.success, false);
        assert.match(data.message, /audience mismatch/i);
      } finally {
        authRouter.resetGoogleTokenVerifierForTesting();
      }
    });

    await runAsyncTest('T13: Token with unverified email (email_verified: false) returns HTTP 401', async () => {
      authRouter.setGoogleTokenVerifierForTesting(async () => ({
        sub: 'google-sub-12345',
        email: 'unverified@nexora.ai',
        email_verified: false,
        iss: 'https://accounts.google.com',
        aud: TEST_CLIENT_ID,
      }));

      try {
        const res = await fetch(`${baseUrl}/api/auth/google`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ credential: 'unverified-email-token' }),
        });
        const data = await res.json();
        assert.strictEqual(res.status, 401);
        assert.strictEqual(data.success, false);
        assert.match(data.message, /not verified/i);
      } finally {
        authRouter.resetGoogleTokenVerifierForTesting();
      }
    });

    // =========================================================================
    // SECTION 4: User Provisioning, Account Linking & Collision Policies
    // =========================================================================
    console.log('\n--- SECTION 4: User Provisioning, Account Linking & Collision Policies ---');

    const googleUserSub = `google_sub_${Date.now()}`;
    const googleUserEmail = `operator_${Date.now()}@nexora.ai`;
    const googleUserName = 'Nexora Test Operator';

    await runAsyncTest('T14: Valid Google ID token provisions new user with googleId, null passwordHash, and google provider', async () => {
      authRouter.setGoogleTokenVerifierForTesting(async () => ({
        sub: googleUserSub,
        email: googleUserEmail,
        name: googleUserName,
        email_verified: true,
        iss: 'https://accounts.google.com',
        aud: TEST_CLIENT_ID,
      }));

      try {
        const res = await fetch(`${baseUrl}/api/auth/google`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ credential: 'valid-google-jwt' }),
        });
        const data = await res.json();
        assert.strictEqual(res.status, 200);
        assert.strictEqual(data.success, true);
        assert.strictEqual(data.user.email, googleUserEmail);
        assert.strictEqual(data.user.name, googleUserName);
        assert.strictEqual(data.user.authProvider, 'google');
        assert.strictEqual(data.user.passwordHash, undefined);

        // Verify DB record directly
        const dbUser = await User.findOne({ googleId: googleUserSub });
        assert.ok(dbUser, 'User must exist in MongoDB');
        createdUserIds.push(dbUser._id);
        assert.strictEqual(dbUser.authProvider, 'google');
        assert.strictEqual(dbUser.passwordHash, null);
        assert.strictEqual(dbUser.firebaseUid, null);
      } finally {
        authRouter.resetGoogleTokenVerifierForTesting();
      }
    });

    await runAsyncTest('T15: Returns secure HTTP-only nexora_token session cookie and sanitized user profile', async () => {
      authRouter.setGoogleTokenVerifierForTesting(async () => ({
        sub: googleUserSub,
        email: googleUserEmail,
        name: googleUserName,
        email_verified: true,
        iss: 'accounts.google.com',
        aud: TEST_CLIENT_ID,
      }));

      try {
        const res = await fetch(`${baseUrl}/api/auth/google`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ credential: 'valid-google-jwt-cookie-check' }),
        });
        assert.strictEqual(res.status, 200);

        const setCookieHeader = res.headers.get('set-cookie');
        assert.ok(setCookieHeader, 'Set-Cookie header must be present');
        assert.ok(setCookieHeader.includes(`${COOKIE_NAME}=`), 'nexora_token cookie must be set');
        assert.ok(setCookieHeader.toLowerCase().includes('httponly'), 'Cookie must be HttpOnly');
        assert.ok(setCookieHeader.toLowerCase().includes('samesite=lax'), 'Cookie must have SameSite=lax');

        // Extract cookie and verify /api/auth/me session recognition
        const cookieVal = setCookieHeader.split(';')[0];
        const meRes = await fetch(`${baseUrl}/api/auth/me`, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Cookie: cookieVal,
          },
        });
        assert.strictEqual(meRes.status, 200);
        const meData = await meRes.json();
        assert.strictEqual(meData.success, true);
        assert.strictEqual(meData.user.email, googleUserEmail);
        assert.strictEqual(meData.user.authProvider, 'google');
      } finally {
        authRouter.resetGoogleTokenVerifierForTesting();
      }
    });

    await runAsyncTest('T16: Repeat Google sign-in reuses existing user identity without duplicate creation', async () => {
      const countBefore = await User.countDocuments({ googleId: googleUserSub });
      assert.strictEqual(countBefore, 1);

      authRouter.setGoogleTokenVerifierForTesting(async () => ({
        sub: googleUserSub,
        email: googleUserEmail,
        name: 'Updated Name (Repeat)',
        email_verified: true,
        iss: 'https://accounts.google.com',
        aud: TEST_CLIENT_ID,
      }));

      try {
        const res = await fetch(`${baseUrl}/api/auth/google`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ credential: 'repeat-sign-in-token' }),
        });
        const data = await res.json();
        assert.strictEqual(res.status, 200);
        assert.strictEqual(data.success, true);
        assert.strictEqual(data.user.email, googleUserEmail);

        const countAfter = await User.countDocuments({ googleId: googleUserSub });
        assert.strictEqual(countAfter, 1, 'No duplicate user documents should be created');
      } finally {
        authRouter.resetGoogleTokenVerifierForTesting();
      }
    });

    await runAsyncTest('T17: Google sign-in for email existing as password account safely conflicts (HTTP 409) and preserves password', async () => {
      const localEmail = `local_operator_${Date.now()}@nexora.ai`;
      const passwordPlain = 'Password123Secure!';
      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(passwordPlain, salt);

      const localUser = await User.create({
        name: 'Local Password User',
        email: localEmail,
        passwordHash,
        authProvider: 'local',
        firebaseUid: null,
      });
      createdUserIds.push(localUser._id);

      authRouter.setGoogleTokenVerifierForTesting(async () => ({
        sub: `google_attacker_sub_${Date.now()}`,
        email: localEmail, // Attempt to sign in via Google with the local user's email
        name: 'Attacker or Alternate Account',
        email_verified: true,
        iss: 'https://accounts.google.com',
        aud: TEST_CLIENT_ID,
      }));

      try {
        const res = await fetch(`${baseUrl}/api/auth/google`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ credential: 'collision-attempt-token' }),
        });
        const data = await res.json();
        assert.strictEqual(res.status, 409);
        assert.strictEqual(data.success, false);
        assert.match(data.message, /already exists using password authentication/i);

        // Verify local account was NOT modified
        const refetched = await User.findById(localUser._id);
        assert.strictEqual(refetched.authProvider, 'local');
        assert.strictEqual(refetched.googleId, null);
        assert.strictEqual(refetched.passwordHash, passwordHash);
      } finally {
        authRouter.resetGoogleTokenVerifierForTesting();
      }
    });

    // =========================================================================
    // SECTION 5: End-to-End Regression & Environment Consistency
    // =========================================================================
    console.log('\n--- SECTION 5: End-to-End Regression & Environment Consistency ---');

    await runAsyncTest('T18: Standard email/password authentication functions without regression', async () => {
      const regEmail = `regression_${Date.now()}@nexora.ai`;
      const regPass = 'ValidSecret123!';

      // 1. Signup
      const signupRes = await fetch(`${baseUrl}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Regression User',
          email: regEmail,
          password: regPass,
        }),
      });
      const signupData = await signupRes.json();
      assert.strictEqual(signupRes.status, 201);
      assert.strictEqual(signupData.success, true);
      createdUserIds.push(new mongoose.Types.ObjectId(signupData.user.id));

      // 2. Login
      const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: regEmail,
          password: regPass,
        }),
      });
      const loginData = await loginRes.json();
      assert.strictEqual(loginRes.status, 200);
      assert.strictEqual(loginData.success, true);
      assert.strictEqual(loginData.user.email, regEmail);
      assert.strictEqual(loginData.user.authProvider, 'local');

      const cookie = loginRes.headers.get('set-cookie');
      assert.ok(cookie && cookie.includes(COOKIE_NAME));
    });

    runSyncTest('T19: Environment templates (backend & frontend) document Google client ID configurations', () => {
      const backendTemplate = fs.readFileSync(path.resolve(__dirname, '../.env.production.example'), 'utf8');
      assert.ok(backendTemplate.includes('GOOGLE_CLIENT_ID='), 'backend .env.production.example must document GOOGLE_CLIENT_ID');
      assert.ok(backendTemplate.includes('OAuth 2.0 Client ID'), 'backend .env.production.example must contain guidance');

      const frontendTemplate = fs.readFileSync(path.resolve(__dirname, '../../frontend/nexora/.env.example'), 'utf8');
      assert.ok(frontendTemplate.includes('VITE_GOOGLE_CLIENT_ID='), 'frontend .env.example must document VITE_GOOGLE_CLIENT_ID');
    });

    runSyncTest('T20: GoogleAuthButton component contract enforces disabled (COMING SOON) state when unconfigured', () => {
      const buttonPath = path.resolve(__dirname, '../../frontend/nexora/src/components/auth/GoogleAuthButton.jsx');
      assert.ok(fs.existsSync(buttonPath), 'GoogleAuthButton.jsx must exist');
      const buttonCode = fs.readFileSync(buttonPath, 'utf8');
      assert.ok(buttonCode.includes('VITE_GOOGLE_CLIENT_ID'), 'Must read VITE_GOOGLE_CLIENT_ID');
      assert.ok(buttonCode.includes('CONTINUE WITH GOOGLE (COMING SOON)'), 'Must default to (COMING SOON) when unconfigured');
      assert.ok(buttonCode.includes('loadGsiScript'), 'Must contain lazy GIS script loader');
      assert.ok(buttonCode.includes('google.accounts.id'), 'Must integrate with Google Identity Services');
    });

  } finally {
    // Teardown HTTP server
    if (httpServer) {
      await new Promise((resolve) => httpServer.close(resolve));
    }

    // Clean up created test users
    if (createdUserIds.length > 0) {
      try {
        await User.deleteMany({ _id: { $in: createdUserIds } });
      } catch (err) {
        console.warn('Warning: Failed to clean up test users:', err.message);
      }
    }

    await mongoose.disconnect();
  }

  console.log('\n====================================================');
  console.log(`  PHASE 3.2 SUITE RESULTS: ${passedTests} / ${totalTests} PASSED`);
  if (failedTests > 0) {
    console.error(`  ${failedTests} TESTS FAILED`);
    process.exit(1);
  } else {
    console.log('  ALL TESTS PASSED SUCCESSFULLY');
    console.log('====================================================\n');
  }
}

if (require.main === module) {
  runPhase3_2Suite().catch((err) => {
    console.error('Fatal error running Phase 3.2 suite:', err);
    process.exit(1);
  });
}

module.exports = { runPhase3_2Suite };
