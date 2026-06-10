import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/server/db/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://caloriemaster:caloriemaster@localhost:5432/caloriemaster",
  },
  verbose: true,
  strict: true,
});
