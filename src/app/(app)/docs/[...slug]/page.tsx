import { db } from "@/db/client";
import { createReaderRepository } from "@/db/repositories/reader-repository";

import { ReaderDocument } from "./reader-document";

type ReaderRouteProps = {
  params: Promise<{
    slug: string[];
  }>;
};

function docsPath(slug: string[]): string {
  return `/docs/${slug.join("/")}`;
}

export default async function ReaderPage({ params }: ReaderRouteProps) {
  const { slug } = await params;
  const path = docsPath(slug);
  const page = await createReaderRepository(db).loadReaderPageByPath(path);

  if (!page) {
    return (
      <section className="empty-reader">
        <p className="eyebrow">Not cached yet</p>
        <h1>Document is not available locally</h1>
        <p>
          This Shopify.dev path has not been ingested yet. A request
          form will be added in the next reader task.
        </p>
      </section>
    );
  }

  return <ReaderDocument page={page} />;
}
