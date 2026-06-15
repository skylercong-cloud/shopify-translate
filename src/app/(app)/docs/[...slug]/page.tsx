import { db } from "@/db/client";
import { createIngestionRepository } from "@/db/repositories/ingestion-repository";
import { createJobRepository } from "@/db/repositories/job-repository";
import { createReaderRepository } from "@/db/repositories/reader-repository";
import { SHOPIFY_DEV_ORIGIN } from "@/modules/ingestion/constants";
import { createIngestionService } from "@/modules/ingestion/ingestion-service";
import { createSourceClient } from "@/modules/ingestion/source-client";

import { ReaderDocument } from "./reader-document";

type ReaderRouteProps = {
  params: Promise<{
    slug: string[];
  }>;
};

function docsPath(slug: string[]): string {
  return `/docs/${slug.join("/")}`;
}

function docsUrl(path: string): string {
  return `${SHOPIFY_DEV_ORIGIN}${path}`;
}

type MissingPageRequest =
  | {
      pageId: string;
      jobId: string | null;
      state: "already_current" | "queued" | "promoted";
    }
  | {
      pageId: null;
      jobId: null;
      state: "failed";
      errorMessage: string;
    };

function requestTitle(state: MissingPageRequest["state"]): string {
  if (state === "queued") return "Request queued";
  if (state === "promoted") return "Request already queued";
  if (state === "already_current") return "Recently checked";
  return "Request could not be queued";
}

async function requestMissingPage(path: string): Promise<MissingPageRequest> {
  const ingestionService = createIngestionService({
    ingestionRepository: createIngestionRepository(db),
    jobRepository: createJobRepository(db),
    sourceClient: createSourceClient(),
    now: () => new Date(),
  });

  try {
    return await ingestionService.requestPageIngestion(
      docsUrl(path),
      "high",
    );
  } catch (error) {
    return {
      pageId: null,
      jobId: null,
      state: "failed",
      errorMessage:
        error instanceof Error
          ? error.message
          : "The ingestion request failed.",
    };
  }
}

function MissingReaderDocument({
  path,
  request,
}: {
  path: string;
  request: MissingPageRequest;
}) {
  const failed = request.state === "failed";

  return (
    <section className="empty-reader">
      <p className="eyebrow">Not cached yet</p>
      <h1>{requestTitle(request.state)}</h1>
      <p>
        {failed
          ? "This Shopify.dev path is not available locally yet, and the ingestion request could not be queued."
          : "This Shopify.dev path is not available locally yet. A background worker will fetch it and enqueue translation for new content."}
      </p>
      <p>
        Path: <code>{path}</code>
      </p>
      {request.jobId ? (
        <p>
          Job: <code>{request.jobId}</code>
        </p>
      ) : null}
      {failed ? (
        <p>
          Error: <code>{request.errorMessage}</code>
        </p>
      ) : null}
    </section>
  );
}

export default async function ReaderPage({ params }: ReaderRouteProps) {
  const { slug } = await params;
  const path = docsPath(slug);
  const page = await createReaderRepository(db).loadReaderPageByPath(path);

  if (!page) {
    const request = await requestMissingPage(path);
    return <MissingReaderDocument path={path} request={request} />;
  }

  return <ReaderDocument page={page} />;
}
