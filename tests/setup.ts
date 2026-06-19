import "@testing-library/jest-dom/vitest";
import { afterAll } from "vitest";

import { closeAllModelServers } from "./fixtures/model-server";

afterAll(async () => {
  await closeAllModelServers();
});
