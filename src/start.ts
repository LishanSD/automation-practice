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
  console.log("Waiting for the inventory result...");

  // Wait until the workflow completes and returns its result.
  const result = await handle.result();

  console.log("\nInventory results:");
  console.table(result.products);

  console.log(`\nScreenshot saved at: ${result.screenshotPath}`);

  await connection.close();
}

main().catch((error) => {
  console.error("Workflow starter failed:", error);
  process.exit(1);
});
