# Automation Practice: Temporal + Playwright Workflow

An automated end-to-end workflow utilizing the **Temporal TypeScript SDK** and **Playwright** to scrape product inventory from [SauceDemo](https://www.saucedemo.com) and wait for a human-in-the-loop signal (approval or rejection) to add products to the shopping cart.

---

## Architecture Overview

```text
+------------------+         1. Read Inventory          +--------------------+
|                  | ---------------------------------> |                    |
|                  | <--------------------------------- | Playwright Activity|
|                  |      (saves inventory.png)         |   (SauceDemo UI)   |
|                  |                                    +--------------------+
|                  |
| Temporal Workflow|         2. Pauses & Waits for Signal
| (inventoryCheck) | <---------------------------------- [User / CLI Signal]
|                  |                                      (Approve / Reject)
|                  |
|                  |         3. On Approval: Add To Cart+--------------------+
|                  | ---------------------------------> |                    |
|                  | <--------------------------------- | Playwright Activity|
|                  |         (saves cart.png)           |   (SauceDemo UI)   |
+------------------+                                    +--------------------+
```

1. **Read Inventory Activity**: Launches Chromium, logs in as `standard_user`, scrapes all product names and prices, and saves a screenshot to `artifacts/inventory.png`.
2. **Signal Wait**: Pauses workflow execution until an external `approve` or `reject` signal is received.
3. **Add to Cart Activity** *(on approve)*: Selects the requested item (or first item by default), adds it to the cart, and saves a confirmation screenshot to `artifacts/cart.png`.

---

## Prerequisites

Before running the workflow, ensure you have the following installed:

1. **Node.js** (v18 or higher) and **npm**
2. **Temporal CLI**: Install via official instructions for your OS:
   - **macOS (Homebrew)**: `brew install temporal`
   - **Windows (Scoop)**: `scoop install temporal` or download from [Temporal Releases](https://github.com/temporalio/cli/releases)
   - **Linux**: `curl -sSf https://temporal.download/cli.sh | sh`

---

## Setup & Installation

1. **Clone the repository and install dependencies:**
   ```bash
   git clone https://github.com/LishanSD/automation-practice.git
   cd automation-practice
   npm install
   ```

2. **Install Playwright browser binaries:**
   ```bash
   npx playwright install chromium
   ```

---

## Steps to Run

Running the workflow requires three terminal sessions (or running services in background):

### Step 1: Start Temporal Development Server
In your first terminal, start the local Temporal cluster:
```bash
temporal server start-dev
```
The Temporal Web UI will be available at [http://localhost:8233](http://localhost:8233).

---

### Step 2: Start the Temporal Worker
In a second terminal, launch the worker listening on the `inventory-task-queue`:
```bash
npm run worker
```
You should see:
```text
Temporal worker started. Waiting for tasks...
```

---

### Step 3: Trigger the Workflow Execution
In a third terminal, start a new workflow run. You can choose which engine executes the "Add to Cart" activity:

- **Playwright mode (Default, fast, no API keys needed):**
  ```bash
  npm run start -- --playright
  # or simply: npm run start
  ```

- **Stagehand AI mode (Uses natural-language agent):**
  ```bash
  npm run start -- --stagehand
  ```
This logs in to SauceDemo, captures inventory, displays the product list, and pauses with output similar to:
```text
Started workflow: inventory-check-1718000000000

Workflow is running and reading inventory...
Once inventory is read, the workflow pauses and waits for your signal.
Waiting for workflow completion...
```

---

### Step 4: Send an Approval or Rejection Signal
While the workflow is paused waiting for input, open another terminal (or use the third terminal) and send a signal using either method below:

#### Option A: Using the project's helper script (Recommended)
Replace `<workflow-id>` with the actual ID printed by `npm run start` (e.g. `inventory-check-1718000000000`):

- **Approve (default item / first item):**
  ```bash
  npm run signal -- <workflow-id> approve
  ```

- **Approve with a specific item name:**
  ```bash
  npm run signal -- <workflow-id> approve "Sauce Labs Backpack"
  ```
  *(Other examples: `"Sauce Labs Bike Light"`, `"Sauce Labs Bolt T-Shirt"`)*

- **Reject the workflow:**
  ```bash
  npm run signal -- <workflow-id> reject
  ```

#### Option B: Using the Temporal CLI directly

- **Approve:**
  ```bash
  temporal workflow signal --workflow-id <workflow-id> --name approve
  ```

- **Approve with custom item:**
  ```bash
  temporal workflow signal --workflow-id <workflow-id> --name approve --input '"Sauce Labs Backpack"'
  ```

- **Reject:**
  ```bash
  temporal workflow signal --workflow-id <workflow-id> --name reject
  ```

---

## Level 3: Retries, Timeouts & Error Handling Scenarios

Level 3 teaches the differences between transient errors (retryable), permanent errors (non-retryable), and timeouts.

### 1. Watch Temporal Retry a Flaky Activity
Simulate a transient network/UI glitch on attempt #1:
```bash
npm run start -- --simulate-retry
```
- **What happens**: The activity throws a standard `Error` on attempt #1. Temporal's `RetryPolicy` catches it, waits for the initial interval (`1s`), and triggers attempt #2 which succeeds.
- **Where to observe**: Check the worker terminal or [http://localhost:8233](http://localhost:8233) to see both attempts.

### 2. Non-Retryable Failure (`locked_out_user`)
Test a permanent authorization failure:
```bash
npm run start -- --user locked_out_user
```
- **What happens**: SauceDemo displays an error stating the user is locked out. The activity throws `ApplicationFailure.nonRetryable(..., "LockedOutUserError")`.
- **Temporal Behavior**: Temporal immediately terminates the activity and fails the workflow **without retrying**, preventing wasted executions on permanent errors.

### 3. Slow-Page Timeout (`performance_glitch_user`)
Test timeout enforcement when a page hangs or takes too long:
```bash
npm run start -- --user performance_glitch_user --timeout 3s
```
- **What happens**: SauceDemo's `performance_glitch_user` takes ~6 seconds to load the page. Because `startToCloseTimeout` is configured to `3s`, Temporal times out the activity (`START_TO_CLOSE`).

---

## Output & Artifacts

After completion, results and logs are displayed in the terminal:
- **Terminal Summary**: Displays a console table listing scraped products, item added, and workflow status.
- **Screenshots**: Saved directly in the `artifacts/` directory:
  - `artifacts/inventory.png`: Full-page snapshot of the SauceDemo inventory page.
  - `artifacts/cart.png`: Snapshot of the cart containing the selected item (if approved).

---

## Project Structure

```text
automation-practice/
├── artifacts/              # Generated full-page screenshots (inventory.png, cart.png)
├── src/
│   ├── activities.ts       # Playwright activities (readInventory, addToCart) with retry & error handling
│   ├── workflows.ts        # Temporal workflow definition, retry policies & signals
│   ├── worker.ts           # Temporal worker process
│   ├── start.ts            # Client script to initiate workflows with CLI options
│   └── signal.ts           # Helper script to send approve/reject signals
├── AGENTS.md               # 3-Level learning ladder guide
├── package.json            # Dependencies and npm scripts
├── tsconfig.json           # TypeScript configuration
└── README.md               # Project documentation
```

---

## Available NPM Scripts

| Script | Command | Description |
| :--- | :--- | :--- |
| `npm run worker` | `tsx src/worker.ts` | Starts the Temporal worker listening for workflow/activity tasks |
| `npm run start` | `tsx src/start.ts` | Starts a workflow (supports `--simulate-retry`, `--user`, `--timeout`) |
| `npm run signal -- <id> <approve\|reject> [item]` | `tsx src/signal.ts ...` | Sends an approve or reject signal to a paused workflow |
