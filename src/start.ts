import { Connection, Client, WorkflowFailedError } from "@temporalio/client";
import { inventoryWorkflow, type WorkflowOptions } from "./workflows";

function parseArgs(): { options: WorkflowOptions; isHelp: boolean } {
  const args = process.argv.slice(2);
  const options: WorkflowOptions = {};
  let isHelp = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      isHelp = true;
    } else if (arg === "--approval") {
      options.requireApproval = true;
    } else if (arg === "--both") {
      options.mode = "both";
    } else if (arg === "--playwright" || arg === "--playright") {
      options.mode = "playwright";
    } else if (arg === "--stagehand") {
      options.mode = "stagehand";
    } else if (arg === "--simulate-retry" || arg === "--flaky") {
      options.simulateFirstAttemptFailure = true;
    } else if (arg === "--user" && i + 1 < args.length) {
      options.username = args[++i];
    } else if (arg === "--timeout" && i + 1 < args.length) {
      options.activityTimeout = args[++i];
    } else if (arg === "--attempts" && i + 1 < args.length) {
      options.maxAttempts = parseInt(args[++i], 10);
    }
  }

  return { options, isHelp };
}

function printUsage() {
  console.log(`
Usage: npm run start [-- <options>]

Options:
  --approval                     Pause after inventory check and wait for human approval signal.
  --playwright, --playright      Add to cart with native Playwright (fast, deterministic - default).
  --stagehand                    Add to cart with Stagehand AI agent (natural language prompts).
  --both                         Try Playwright first; automatically fall back to Stagehand if Playwright fails.
  --simulate-retry, --flaky       Simulate a transient failure on attempt #1 to watch Temporal retry.
  --user <username>              SauceDemo username to run with:
                                   • standard_user (default)
                                   • locked_out_user (demonstrates non-retryable failure)
                                   • performance_glitch_user (demonstrates slow-page timeouts)
  --timeout <duration>           Activity startToCloseTimeout (e.g. '3s', '4s', '2 minutes')
  --attempts <num>               Maximum retry attempts (default: 3)
  --help, -h                     Show this help message

Cart Mode Examples:
  • Automatic execution (default - adds first item without pausing):
     npm run start
     (or npm run start -- --playright)

  • With Human Approval Signal:
     npm run start -- --approval
     npm run start -- --approval --stagehand

  • Run with Stagehand AI (automatic):
     npm run start -- --stagehand

  • Run in resilient Both mode (Playwright first, Stagehand fallback):
     npm run start -- --both

Level 3 Examples:
  1. Watch Temporal retry a flaky attempt:
     npm run start -- --simulate-retry

  2. Watch a non-retryable error (fails immediately without retry):
     npm run start -- --user locked_out_user

  3. Watch a slow-page timeout (glitch user takes ~6s, timeout set to 3s):
     npm run start -- --user performance_glitch_user --timeout 3s
`);
}

async function main() {
  const { options, isHelp } = parseArgs();

  if (isHelp) {
    printUsage();
    process.exit(0);
  }

  // Connect to the local Temporal server.
  const connection = await Connection.connect({
    address: "localhost:7233",
  });

  const client = new Client({ connection });

  const cartMode = options.mode ?? "playwright";
  const modeDescription =
    cartMode === "both"
      ? "Playwright with Stagehand AI fallback"
      : cartMode === "stagehand"
      ? "Stagehand AI Agent"
      : "Native Playwright";
  console.log("==================================================");
  console.log("Starting Workflow Execution");
  console.log(` Cart Mode: ${cartMode.toUpperCase()} (${modeDescription})`);
  console.log(
    ` Approval: ${
      options.requireApproval
        ? "REQUIRED (--approval mode)"
        : "AUTO (adds first item without pausing)"
    }`
  );
  if (options.simulateFirstAttemptFailure) {
    console.log(" Mode: Flaky Activity Simulation (Attempt #1 will fail, #2 will succeed)");
  }
  if (options.username) {
    console.log(` User: ${options.username}`);
  }
  if (options.activityTimeout) {
    console.log(` Activity Timeout: ${options.activityTimeout}`);
  }
  console.log("==================================================");

  // Start a new workflow execution with passed options.
  const handle = await client.workflow.start(inventoryWorkflow, {
    taskQueue: "inventory-task-queue",
    workflowId: `inventory-check-${Date.now()}`,
    args: [options],
  });

  console.log(`Started workflow: ${handle.workflowId}`);
  if (options.requireApproval) {
    console.log("\nWorkflow is running and reading inventory...");
    console.log("Once inventory is read, the workflow pauses and waits for your signal.");
    console.log("\nTo send a signal, run ONE of these one-line CLI commands in another terminal:\n");
    console.log(`  # Approve (adds default or first item):`);
    console.log(`  npm run signal -- ${handle.workflowId} approve\n`);
    console.log(`  # Approve with a specific item:`);
    console.log(`  npm run signal -- ${handle.workflowId} approve "Sauce Labs Backpack"\n`);
    console.log(`  # Reject:`);
    console.log(`  npm run signal -- ${handle.workflowId} reject\n`);
    console.log("Waiting for signal and workflow completion...\n");
  } else {
    console.log("\nWorkflow is running...");
    console.log("1. Reading inventory and capturing screenshot.");
    console.log("2. Automatically adding first item to cart and capturing screenshot.");
    console.log("Waiting for workflow completion...\n");
  }

  try {
    // Wait until the workflow completes and returns its result.
    const result = await handle.result();

    console.log("==========================================");
    console.log(`Workflow Result: ${result.status.toUpperCase()}`);
    console.log(result.message);
    console.log("==========================================");

    console.log("\nInventory items found:");
    console.table(result.inventory.products);
    console.log(`Inventory screenshot saved at: ${result.inventory.screenshotPath}`);

    if (result.cart) {
      console.log(`\nCart item added: ${result.cart.itemName}`);
      console.log(`Cart screenshot saved at: ${result.cart.screenshotPath}`);
    }
  } catch (error: any) {
    console.log("\n==========================================");
    console.log("WORKFLOW EXECUTION FAILED");
    console.log("==========================================");

    if (error instanceof WorkflowFailedError) {
      const causeMessage = error.cause?.message || error.message;
      console.log(`Failure Reason: ${causeMessage}`);

      if (options.username === "locked_out_user") {
        console.log("\n[Level 3 Lesson] Non-Retryable Error Verified:");
        console.log("Notice that Temporal did NOT retry! Because the error was marked as");
        console.log("ApplicationFailure.nonRetryable, Temporal terminated immediately.");
      } else if (options.activityTimeout) {
        console.log("\n[Level 3 Lesson] Activity Timeout Verified:");
        console.log("The activity took longer than the configured startToCloseTimeout.");
        console.log("Temporal cancelled/timed out the activity as expected!");
      }
    } else {
      console.error(error);
    }
  } finally {
    await connection.close();
  }
}

main().catch((error) => {
  console.error("Workflow starter failed:", error);
  process.exit(1);
});
