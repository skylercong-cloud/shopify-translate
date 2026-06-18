import { db } from "@/db/client";
import { createGlossaryBrowserRepository } from "@/db/repositories/glossary-browser-repository";

import { GlossaryBrowser } from "./glossary-browser";

export default async function GlossaryBrowserPage() {
  const items = await createGlossaryBrowserRepository(db).loadGlossaryVersions();

  return <GlossaryBrowser items={items} />;
}
