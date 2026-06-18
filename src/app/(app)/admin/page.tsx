import { db } from "@/db/client";
import { createOperationsRepository } from "@/db/repositories/operations-repository";

import { OperationsOverviewPanel } from "./operations-overview";

export default async function AdminPage() {
  const overview = await createOperationsRepository(db).loadOverview();

  return <OperationsOverviewPanel overview={overview} />;
}
