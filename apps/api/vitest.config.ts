import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // Tests unitarios sin DB ni Redis: no requieren setup global.
    // Cuando lleguen tests de integración (route-level) añadimos un
    // setup/teardown que levante Postgres en Docker.
  },
});
