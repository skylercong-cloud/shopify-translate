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

export type OperationsPromptStatus = OperationsVersionStatus & {
  systemPrompt: string;
  userPromptTemplate: string;
};

export type OperationsGlossaryStatus = OperationsVersionStatus & {
  termCount: number;
  terms: Array<{
    sourceTerm: string;
    normalizedTerm: string;
  }>;
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

export type OperationsAlert = {
  severity: "critical" | "warning";
  code:
    | "failed_jobs"
    | "missing_glossary"
    | "missing_prompt"
    | "no_enabled_provider";
  title: string;
  message: string;
};

export type OperationsOverview = {
  settings: OperationsRuntimeSettings;
  providers: OperationsProviderStatus[];
  activePrompt: OperationsPromptStatus | null;
  activeGlossary: OperationsGlossaryStatus | null;
  security: {
    activeSessionCount: number;
  };
  jobs: {
    byQueueStatus: OperationsJobCount[];
    recentFailures: OperationsRecentFailure[];
  };
  alerts: OperationsAlert[];
};
