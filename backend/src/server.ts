import { app } from "./app.js";
import { env } from "./config/env.js";
import { prisma } from "./lib/prisma.js";
import { closeSessionStore } from "./middleware/session.js";

const server = app.listen(env.PORT, "0.0.0.0", () => {
  console.log(`Backend listening on port ${env.PORT}`);
});

async function closeResources(): Promise<void> {
  await Promise.all([prisma.$disconnect(), closeSessionStore()]);
}

function shutdown(signal: string): void {
  console.log(`Received ${signal}; shutting down.`);
  server.close((error) => {
    void (async () => {
      try {
        await closeResources();
        process.exit(error ? 1 : 0);
      } catch {
        console.error("Backend resource shutdown failed.");
        process.exit(1);
      }
    })();
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
