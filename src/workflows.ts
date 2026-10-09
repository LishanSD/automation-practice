import { proxyActivities } from "@temporalio/workflow";
import type * as activities from "./activities";

// Configure the activity's timeout and retry behaviour.
const { readInventory } = proxyActivities<typeof activities>({
  startToCloseTimeout: "2 minutes",
  retry: {
    maximumAttempts: 2,
  },
});

export async function inventoryWorkflow() {
  // The workflow delegates the actual browser work to an activity.
  const result = await readInventory();

  // Return the activity result to whoever started the workflow.
  return result;
}
