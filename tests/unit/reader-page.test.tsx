import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createIngestionRepository: vi.fn(() => ({})),
  createIngestionService: vi.fn(),
  createJobRepository: vi.fn(() => ({})),
  createReaderRepository: vi.fn(),
  createSourceClient: vi.fn(() => ({})),
  loadReaderPageByPath: vi.fn(),
  requestPageIngestion: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: {},
}));

vi.mock("@/db/repositories/ingestion-repository", () => ({
  createIngestionRepository: mocks.createIngestionRepository,
}));

vi.mock("@/db/repositories/job-repository", () => ({
  createJobRepository: mocks.createJobRepository,
}));

vi.mock("@/db/repositories/reader-repository", () => ({
  createReaderRepository: mocks.createReaderRepository,
}));

vi.mock("@/modules/ingestion/ingestion-service", () => ({
  createIngestionService: mocks.createIngestionService,
}));

vi.mock("@/modules/ingestion/source-client", () => ({
  createSourceClient: mocks.createSourceClient,
}));

import ReaderPage from "@/app/(app)/docs/[...slug]/page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("reader page route", () => {
  it("queues high priority ingestion when a document is not cached", async () => {
    mocks.createReaderRepository.mockReturnValue({
      loadReaderPageByPath: mocks.loadReaderPageByPath,
    });
    mocks.createIngestionService.mockReturnValue({
      requestPageIngestion: mocks.requestPageIngestion,
    });
    mocks.loadReaderPageByPath.mockResolvedValue(null);
    mocks.requestPageIngestion.mockResolvedValue({
      pageId: "page-id",
      jobId: "job-id",
      state: "queued",
    });

    const element = await ReaderPage({
      params: Promise.resolve({ slug: ["apps", "build"] }),
    });

    render(element);

    expect(mocks.loadReaderPageByPath).toHaveBeenCalledWith(
      "/docs/apps/build",
    );
    expect(mocks.requestPageIngestion).toHaveBeenCalledWith(
      "https://shopify.dev/docs/apps/build",
      "high",
    );
    expect(
      screen.getByRole("heading", { name: "Request queued" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/background worker/i)).toBeInTheDocument();
  });
});
