# NEXORA AI — Autonomous Mission Operating System

> **A high-assurance, tactical AI Mission OS engineered for multi-agent autonomous coordination, real-time telemetry streaming, atomic task scheduling, and verifiable deliverable synthesis.**

---

## 1. System Overview

NEXORA AI orchestrates coordinated autonomous agent enclaves to decompose complex user directives into validated dependency graphs, execute multi-phase tasks concurrently, stream high-fidelity audit trails, and assemble verified deliverables.

### Core Architecture

```
                       ┌──────────────────────────────────────────────┐
                       │          NEXORA COMMAND CONSOLE              │
                       │     (React 19 + Tailwind v4 + Motion)        │
                       │       Dark Void / Electric Violet UX         │
                       └──────────────────────┬───────────────────────┘
                                              │ HTTP / JSON / SSE
                                              ▼
                       ┌──────────────────────────────────────────────┐
                       │            BACKEND API GATEWAY               │
                       │        (Node.js / Express 5.2.1)             │
                       └───────┬──────────────┬───────────────┬───────┘
                               │              │               │
                               ▼              ▼               ▼
                      ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
                      │  Tenant &   │  │   Mission   │  │  Telemetry  │
                      │ Auth Guard  │  │Orchestrator │  │Event Stream │
                      └─────────────┘  └──────┬──────┘  └─────────────┘
                                              │
                      ┌───────────────────────┴───────────────────────┐
                      │          AUTONOMOUS AGENT CLUSTER             │
                      │  • Research Agent       • Analyst Agent       │
                      │  • Builder Agent        • Critic Agent        │
                      │  • QA Verification Gate • Enclave Coordinator │
                      └───────────────────────┬───────────────────────┘
                                              │
                                              ▼
                       ┌──────────────────────────────────────────────┐
                       │             DATA & AUDIT STORE               │
                       │         (MongoDB + Mongoose Schemas)         │
                       └──────────────────────────────────────────────┘
```

---

## 2. Prerequisites

- **Node.js**: `v18.0.0` or higher (tested on Node v20/v22)
- **npm**: `v9.0.0` or higher
- **MongoDB**: Local MongoDB instance (`mongodb://127.0.0.1:27017/nexora`) or hosted MongoDB connection string
- **Google Gemini API Key** *(Optional)*: Required for live LLM reasoning (system falls back cleanly to deterministic local synthesis when absent)
- **Playwright** *(Optional)*: Pre-installed for end-to-end browser verification tasks

---

## 3. Quick Start

### 1. Repository Setup

Clone the repository and install dependencies for backend and frontend:

```bash
# Clone repository
git clone https://github.com/YourOrg/NEXORA-AI.git
cd NEXORA-AI

# Install backend dependencies
cd backend
npm install
cd ..

# Install frontend dependencies
cd frontend/nexora
npm install
cd ../..
```

### 2. Environment Configuration

#### Backend Configuration (`backend/.env`)

Copy the backend environment template:
```bash
cp backend/.env.example backend/.env
```

Ensure the following variables are configured in `backend/.env`:
```ini
PORT=5000
MONGODB_URI=mongodb://127.0.0.1:27017/nexora
JWT_SECRET=your_strong_random_jwt_secret_here
NODE_ENV=development

# Optional: Google Gemini API Key for live AI synthesis
GEMINI_API_KEY=your_gemini_api_key_here
```

#### Frontend Configuration (`frontend/nexora/.env`)

Copy the frontend environment template:
```bash
cp frontend/nexora/.env.example frontend/nexora/.env
```

Default configuration in `frontend/nexora/.env`:
```ini
VITE_API_URL=http://localhost:5000
```

### 3. Launch Development Environment

Run both the backend Express server (Port 5000) and Vite frontend dev server (Port 5173) concurrently from the project root:

```bash
npm run dev
```

Visit `http://localhost:5173` in your browser.

---

## 4. Workspace Scripts

The root `package.json` provides unified, cross-platform commands:

| Command | Action | Description |
| :--- | :--- | :--- |
| `npm run dev` | `node scripts/dev.js` | Launches backend and frontend dev servers concurrently with signal forwarding |
| `npm run build` | `npm run build --prefix frontend/nexora` | Compiles the production bundle for the frontend application |
| `npm run build:frontend` | `npm run build --prefix frontend/nexora` | Targeted frontend production build |
| `npm test` | `node backend/scratch/run_phase2_regressions.js` | Executes the complete deterministic backend regression test harness |
| `npm run test:backend` | `node backend/scratch/run_phase2_regressions.js` | Runs all Phase 2 backend verification test suites |

---

## 5. Mission Lifecycle API Contract

NEXORA exposes an authoritative, tenant-isolated REST API:

### Authentication (`/api/auth`)
- `POST /api/auth/register` — Create operator credentials (email, password, organization).
- `POST /api/auth/login` — Authenticate operator and receive HTTP-only JWT session cookie.
- `GET /api/auth/me` — Verify authenticated session context.
- `POST /api/auth/logout` — Invalidate operator session cookie.

### Mission Orchestration (`/api/missions`)
- `POST /api/missions` — Submit directive and enqueue mission DAG.
- `GET /api/missions/:missionId/result` — Fetch authoritative mission result, artifact deliverable, verification status, and task states.
- `GET /api/missions/:missionId/events?sinceSeq=N` — Incremental telemetry poll for real-time mission execution events (`sinceSeq` watermark deduplication).
- `POST /api/missions/:missionId/cancel` — Abort an active mission with atomic CAS fencing (`reason: 'operator_abort'`).
- `POST /api/missions/:missionId/tasks/:taskId/retry` — Retry an eligible failed task with atomic CAS transition and resume mission execution.

---

## 6. Architectural Reliability & Guarantees

1. **Atomic State Compare-and-Set (CAS)**:
   - Mission status transitions (e.g., active to `cancelled`) and task retries (failed to `pending`) execute atomic database queries to prevent concurrent worker races.
2. **Worker Leasing & Heartbeat Fencing**:
   - Each running task is leased to a worker identity with an expiration timestamp. Stale workers are safely reclaimed without double-execution.
3. **Monotonic Telemetry Sequencing**:
   - Telemetry events emit sequential sequence numbers per mission (`seq: 1, 2, ...`). The frontend client deduplicates by both ID and watermark `sinceSeq`.
4. **Idempotent Sweep & Recovery**:
   - Background recovery reconciles orphaned tasks and verifies invariants across terminal missions without modifying completed work.

---

## 7. Verification & Testing

NEXORA includes an extensive suite of deterministic in-memory regression tests simulating concurrent workers, worker fencing, cancellation interrupts, and API contracts:

```bash
# Run full regression suite from root:
npm test

# Or run targeted verification:
node backend/scratch/verify_step8g6_p2_12.js
```

---

## 8. Troubleshooting

- **Backend Offline / Health Check Warning**:
  - Ensure MongoDB is running (`mongod` service active on `mongodb://127.0.0.1:27017`).
  - Verify port 5000 is open and not occupied by another process.
- **CORS Issues in Development**:
  - Backend allows `http://localhost:5173` and `http://127.0.0.1:5173` with credentials.
- **Telemetry Feeds Empty**:
  - Ensure the mission was dispatched to backend and `VITE_API_URL` points to `http://localhost:5000`.
