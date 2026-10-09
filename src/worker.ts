import { Worker } from "@temporalio/worker";
import path from "node:path";
import * as activities from "./activities";

async function runWorker() {
  const worker = await Worker.create({
    // Connect to the local Temporal development server.
    taskQueue: "inventory-task-queue",

    // Tell Temporal where the workflow definition lives.
    workflowsPath: path.resolve(__dirname, "workflows.ts"),

    // Register the activity implementation.
    activities,
  });

  console.log("Temporal worker started. Waiting for tasks...");

  // Keep polling Temporal until the process is stopped.
  await worker.run();
}

runWorker().catch((error) => {
  console.error("Worker failed:", error);
  process.exit(1);
});
