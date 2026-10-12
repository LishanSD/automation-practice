import { Connection, Client } from "@temporalio/client";
import { inventoryWorkflow } from "./workflows";

async function main() {
  // Connect to the local Temporal server.
  const connection = await Connection.connect({
    address: "localhost:7233",
  });

  const client = new Client({ connection });

  // Start a new workflow execution.
  const handle = await client.workflow.start(inventoryWorkflow, {
    taskQueue: "inventory-task-queue",
    workflowId: `inventory-check-${Date.now()}`,
  });

  console.log(`Started workflow: ${handle.workflowId}`);
  console.log("\nWorkflow is running and reading inventory...");
  console.log("Once inventory is read, the workflow pauses and waits for your signal.");
  console.log("\nTo send a signal, run ONE of these one-line CLI commands in another terminal:\n");
  console.log(`  # Approve (adds default or first item):`);
  console.log(`  temporal workflow signal --workflow-id ${handle.workflowId} --name approve\n`);
  console.log(`  # Approve with a specific item:`);
  console.log(`  temporal workflow signal --workflow-id ${handle.workflowId} --name approve --input '"Sauce Labs Backpack"'\n`);
  console.log(`  # Reject:`);
  console.log(`  temporal workflow signal --workflow-id ${handle.workflowId} --name reject\n`);
  console.log("Waiting for workflow completion...\n");

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

  await connection.close();
}

main().catch((error) => {
  console.error("Workflow starter failed:", error);
  process.exit(1);
});
