# Learning Ladder: Temporal + Playwright (Levels 1 – 3)

This document provides a concise, step-by-step learning ladder covering the core mechanics of Temporal workflows orchestrated with Playwright automation.

---

## The Three Levels at a Glance

| Level | Temporal Concepts | Playwright Concepts | Writes to Site | Key Lesson |
| :--- | :--- | :--- | :--- | :--- |
| **Level 1** | Workflow, Activity, Worker | Browser launch, login, scrape inventory, screenshot | None | Separation of workflow orchestration from activity side-effects |
| **Level 2** | Signals, `condition()`, Waiting | Add chosen product to cart, verify cart UI | Cart only | Human-in-the-loop decision making |
| **Level 3** | Retry policies, timeouts (`startToCloseTimeout`), non-retryable errors | Flaky UI handling, error detection, slow pages | Cart only | Distinguishing transient errors from permanent failures |

---

## Level 1: Basic Workflow & Activities

### Concept
Temporal separates **workflows** (pure, deterministic orchestration) from **activities** (non-deterministic operations that interact with the real world, like launching browsers, making network calls, or querying databases).

### Implementation
- `src/activities.ts`: `readInventory()` launches Playwright in Chromium, logs into `saucedemo.com`, scrapes all product cards, and saves `artifacts/inventory.png`.
- `src/workflows.ts`: `inventoryWorkflow()` invokes `readInventory()` through `proxyActivities`.
- `src/worker.ts`: Listens on `inventory-task-queue` and executes the activity when summoned.
- `src/start.ts`: Connects to Temporal and starts the workflow.

### [Human Task] Run Level 1
1. In Terminal 1: `temporal server start-dev`
2. In Terminal 2: `npm run worker`
3. In Terminal 3: `npm run start`
4. Inspect [http://localhost:8233](http://localhost:8233) to see the execution history and check `artifacts/inventory.png`.

---

## Level 2: Human-in-the-Loop Signals

### Concept
Workflows can pause indefinitely without consuming CPU or memory using Temporal's `condition()` primitive. External systems (humans, webhooks, CLI commands) send **signals** to resume or steer the execution.

### Implementation
- `approveSignal` & `rejectSignal`: Defined in `src/workflows.ts` via `defineSignal`.
- Workflow pauses: `await condition(() => decision !== null);`
- On approval: Triggers `addToCart(targetItem)` activity to add the item and screenshot `artifacts/cart.png`.
- On rejection: Exits gracefully without adding items to cart.
- `src/signal.ts`: CLI script to send signals with optional item selection.

### [Human Task] Run Level 2
1. Start the workflow in approval mode:
   ```bash
   npm run start -- --approval
   ```
2. The workflow prints instructions and pauses waiting for your signal.
3. In another terminal, approve with a specific item:
   ```bash
   npm run signal -- <workflowId> approve "Sauce Labs Bike Light"
   ```
   Or reject:
   ```bash
   npm run signal -- <workflowId> reject
   ```
4. Verify the cart screenshot in `artifacts/cart.png`.

---

## Level 3: Retries, Timeouts & Error Types

### Concept
Real-world systems are prone to failures. Temporal allows configuring fine-grained **RetryPolicies** and **Timeouts**:
1. **Retryable Errors**: Transient issues (network hiccups, momentary rate limits) should be retried automatically.
2. **Non-Retryable Errors**: Permanent issues (e.g. invalid credentials, account locked out) should fail immediately so resources aren't wasted.
3. **Timeouts (`startToCloseTimeout`)**: Guard against activities hanging indefinitely or pages that take too long to load.

### Implementation
- **Retry Policy & Timeouts** (`src/workflows.ts`):
  ```ts
  const { readInventory, addToCart } = proxyActivities<typeof activities>({
    startToCloseTimeout: options?.activityTimeout ?? "2 minutes",
    retry: {
      initialInterval: "1s",
      backoffCoefficient: 2,
      maximumAttempts: options?.maxAttempts ?? 3,
      nonRetryableErrorTypes: ["LockedOutUserError"],
    },
  });
  ```

- **Attempt Inspection & Simulated Flakiness** (`src/activities.ts`):
  ```ts
  const attempt = Context.current().info.attempt;
  if (options?.simulateFirstAttemptFailure && attempt === 1) {
    throw new Error("Simulated transient error on attempt 1");
  }
  ```

- **Permanent Failure Handling** (`src/activities.ts`):
  ```ts
  if (outcome === "error") {
    throw ApplicationFailure.nonRetryable(
      `User '${username}' cannot log in: ${errorText}`,
      "LockedOutUserError"
    );
  }
  ```

### [Human Task] Run Level 3 Scenarios

#### Scenario 1: Flaky Activity Retry
Simulate a transient failure on attempt #1 and watch Temporal automatically retry and succeed on attempt #2:
```bash
npm run start -- --simulate-retry
```
- **What to observe**: In the worker console and Temporal Web UI, attempt #1 throws an error, waits 1s, and attempt #2 runs and succeeds.

#### Scenario 2: Non-Retryable Error (Locked Out User)
Run against SauceDemo's `locked_out_user`:
```bash
npm run start -- --user locked_out_user
```
- **What to observe**: SauceDemo rejects the login. The activity throws `ApplicationFailure.nonRetryable`. Temporal terminates immediately **without retrying**.

#### Scenario 3: Activity Timeout (Performance Glitch User)
Run against SauceDemo's `performance_glitch_user` (which takes ~6 seconds to load) with a 3-second timeout:
```bash
npm run start -- --user performance_glitch_user --timeout 3s
```
- **What to observe**: Because the activity exceeds the 3-second `startToCloseTimeout`, Temporal marks the attempt as timed out (`START_TO_CLOSE`).
