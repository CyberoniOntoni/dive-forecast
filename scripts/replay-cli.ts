import { main } from "./replay";

main().catch((err) => {
  console.error("Replay run failed with uncaught exception:", err);
  process.exit(1);
});
