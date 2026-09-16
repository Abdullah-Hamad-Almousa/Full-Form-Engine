import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// Load the repository-root .env so DATABASE_URL is available to Prisma CLI
// commands run from the backend directory during local development.
config({ path: "../.env" });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations"
  }
});
