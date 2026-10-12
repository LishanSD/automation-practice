import { Connection, Client } from "@temporalio/client";
import { approveSignal, rejectSignal } from "./workflows";

async function main() {
  const args = process.argv.slice(2);
  const workflowId = args[0];
  const action = args[1]?.toLowerCase();
  const itemName = args.slice(2).join(" ");

  if (!workflowId || !action || !["approve", "reject"].includes(action)) {
    console.log("Usage: npm run signal -- <workflowId> <approve|reject> [itemName]");
    console.log("Example:");
    console.log("  npm run signal -- inventory-check-1718000000 approve");
    console.log("  npm run signal -- inventory-check-1718000000 approve \"Sauce Labs Backpack\"");
    console.log("  npm run signal -- inventory-check-1718000000 reject");
    process.exit(1);
  }

  const connection = await Connection.connect({
    address: "localhost:7233",
  });
  const client = new Client({ connection });
  const handle = client.workflow.getHandle(workflowId);

  if (action === "approve") {
    await handle.signal(approveSignal, itemName || undefined);
    console.log(
      `Sent 'approve' signal to workflow: ${workflowId}${
        itemName ? ` (chosen item: '${itemName}')` : ""
      }`
    );
  } else {
    await handle.signal(rejectSignal);
    console.log(`Sent 'reject' signal to workflow: ${workflowId}`);
  }

  await connection.close();
}

main().catch((err) => {
  console.error("Signal failed:", err);
  process.exit(1);
});
