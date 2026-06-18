import type {
  jobQueues,
  jobStatuses,
  jobTypes,
  translationProviders,
} from "@/db/schema";

export type OperationsProviderStatus = {
  provider: (typeof translationProviders)[number];
  baseUrl: string;
  modelId: string;
  keyHint: string | null;
  enabled: boolean;
  updatedAt: Date;
};

export type OperationsRuntimeSettings = {
  dailyTokenLimit: number | null;
  budgetTimeZone: "Asia/Shanghai";
  requestTimeoutMs: number;
  maxInputBytes: number;
  maxOutputTokens: number;
  workerConcurrency: number;
};

export type OperationsVersionStatus = {
  id: string;
  version: number;
  createdAt: Date;
};

export type OperationsGlossaryStatus = OperationsVersionStatus & {
  termCount: number;
};

export type OperationsJobCount = {
  queue: (typeof jobQueues)[number];
  status: (typeof jobStatuses)[number];
  count: number;
};

export type OperationsRecentFailure = {
  id: string;
  queue: (typeof jobQueues)[number];
  type: (typeof jobTypes)[number];
  attempts: number;
  maxAttempts: number;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  updatedAt: Date;
};

export type OperationsOverview = {
  settings: OperationsRuntimeSettings;
  providers: OperationsProviderStatus[];
  activePrompt: OperationsVersionStatus | null;
  activeGlossary: OperationsGlossaryStatus | null;
  jobs: {
    byQueueStatus: OperationsJobCount[];
    recentFailures: OperationsRecentFailure[];
  };
};
