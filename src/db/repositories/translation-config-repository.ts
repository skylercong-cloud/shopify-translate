import { asc, eq, max } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type * as schema from "@/db/schema";
import {
  glossaryTerms,
  glossaryVersions,
  modelProviderConfigs,
  promptVersions,
  translationSettings,
  type translationProviders,
} from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;

export type TranslationProvider = (typeof translationProviders)[number];
export type StoredProviderConfig = typeof modelProviderConfigs.$inferSelect;
export type StoredPromptVersion = typeof promptVersions.$inferSelect;
export type StoredGlossaryTerm = Pick<
  typeof glossaryTerms.$inferSelect,
  "id" | "sourceTerm" | "normalizedTerm"
>;
export type StoredGlossaryVersion =
  typeof glossaryVersions.$inferSelect & {
    terms: StoredGlossaryTerm[];
  };

export type TranslationRuntimeSettings = {
  dailyTokenLimit: number | null;
  budgetTimeZone: "Asia/Shanghai";
  requestTimeoutMs: number;
  maxInputBytes: number;
  maxOutputTokens: number;
  workerConcurrency: number;
};

export type RuntimeSettingsUpdate = {
  dailyTokenLimit?: number;
  requestTimeoutMs?: number;
  maxInputBytes?: number;
  maxOutputTokens?: number;
  workerConcurrency?: number;
};

export type ProviderConfigInput = Pick<
  StoredProviderConfig,
  | "provider"
  | "baseUrl"
  | "modelId"
  | "encryptedApiKey"
  | "keyHint"
  | "enabled"
>;

export type PromptVersionInput = Pick<
  StoredPromptVersion,
  "systemPrompt" | "userPromptTemplate" | "contentFingerprint"
>;

export type GlossaryVersionInput = {
  contentFingerprint: string;
  terms: Array<{
    sourceTerm: string;
    normalizedTerm: string;
  }>;
};

export interface TranslationConfigRepository {
  upsertProvider(input: ProviderConfigInput): Promise<StoredProviderConfig>;
  getProvider(
    provider: TranslationProvider,
  ): Promise<StoredProviderConfig | null>;
  listProviders(): Promise<StoredProviderConfig[]>;
  updateSettings(
    input: RuntimeSettingsUpdate,
  ): Promise<TranslationRuntimeSettings>;
  getSettings(): Promise<TranslationRuntimeSettings>;
  createAndActivatePrompt(
    input: PromptVersionInput,
  ): Promise<StoredPromptVersion>;
  getActivePrompt(): Promise<StoredPromptVersion | null>;
  createAndActivateGlossary(
    input: GlossaryVersionInput,
  ): Promise<StoredGlossaryVersion>;
  getActiveGlossary(): Promise<StoredGlossaryVersion | null>;
}

function toRuntimeSettings(
  row: typeof translationSettings.$inferSelect,
): TranslationRuntimeSettings {
  return {
    dailyTokenLimit: row.dailyTokenLimit,
    budgetTimeZone: "Asia/Shanghai",
    requestTimeoutMs: row.requestTimeoutMs,
    maxInputBytes: row.maxInputBytes,
    maxOutputTokens: row.maxOutputTokens,
    workerConcurrency: row.workerConcurrency,
  };
}

export function createTranslationConfigRepository(
  db: Database,
): TranslationConfigRepository {
  async function ensureSettings() {
    await db
      .insert(translationSettings)
      .values({ singleton: true })
      .onConflictDoNothing();

    const row = await db.query.translationSettings.findFirst({
      where: eq(translationSettings.singleton, true),
    });
    if (!row) {
      throw new Error("Translation settings row could not be created");
    }
    return row;
  }

  async function getGlossaryTerms(
    glossaryVersionId: string,
  ): Promise<StoredGlossaryTerm[]> {
    return db
      .select({
        id: glossaryTerms.id,
        sourceTerm: glossaryTerms.sourceTerm,
        normalizedTerm: glossaryTerms.normalizedTerm,
      })
      .from(glossaryTerms)
      .where(eq(glossaryTerms.glossaryVersionId, glossaryVersionId))
      .orderBy(asc(glossaryTerms.normalizedTerm));
  }

  return {
    async upsertProvider(input) {
      const [stored] = await db
        .insert(modelProviderConfigs)
        .values(input)
        .onConflictDoUpdate({
          target: modelProviderConfigs.provider,
          set: {
            baseUrl: input.baseUrl,
            modelId: input.modelId,
            encryptedApiKey: input.encryptedApiKey,
            keyHint: input.keyHint,
            enabled: input.enabled,
            updatedAt: new Date(),
          },
        })
        .returning();
      return stored;
    },

    async getProvider(provider) {
      return (
        (await db.query.modelProviderConfigs.findFirst({
          where: eq(modelProviderConfigs.provider, provider),
        })) ?? null
      );
    },

    listProviders() {
      return db
        .select()
        .from(modelProviderConfigs)
        .orderBy(asc(modelProviderConfigs.provider));
    },

    async updateSettings(input) {
      await ensureSettings();
      const [stored] = await db
        .update(translationSettings)
        .set({
          ...input,
          updatedAt: new Date(),
        })
        .where(eq(translationSettings.singleton, true))
        .returning();
      return toRuntimeSettings(stored);
    },

    async getSettings() {
      return toRuntimeSettings(await ensureSettings());
    },

    createAndActivatePrompt(input) {
      return db.transaction(async (transaction) => {
        await transaction
          .insert(translationSettings)
          .values({ singleton: true })
          .onConflictDoNothing();
        await transaction
          .select({ singleton: translationSettings.singleton })
          .from(translationSettings)
          .where(eq(translationSettings.singleton, true))
          .for("update");

        const [latest] = await transaction
          .select({ version: max(promptVersions.version) })
          .from(promptVersions);
        await transaction
          .update(promptVersions)
          .set({ active: false })
          .where(eq(promptVersions.active, true));
        const [stored] = await transaction
          .insert(promptVersions)
          .values({
            ...input,
            version: (latest.version ?? 0) + 1,
            active: true,
          })
          .returning();
        return stored;
      });
    },

    async getActivePrompt() {
      return (
        (await db.query.promptVersions.findFirst({
          where: eq(promptVersions.active, true),
        })) ?? null
      );
    },

    createAndActivateGlossary(input) {
      return db.transaction(async (transaction) => {
        await transaction
          .insert(translationSettings)
          .values({ singleton: true })
          .onConflictDoNothing();
        await transaction
          .select({ singleton: translationSettings.singleton })
          .from(translationSettings)
          .where(eq(translationSettings.singleton, true))
          .for("update");

        const [latest] = await transaction
          .select({ version: max(glossaryVersions.version) })
          .from(glossaryVersions);
        await transaction
          .update(glossaryVersions)
          .set({ active: false })
          .where(eq(glossaryVersions.active, true));
        const [stored] = await transaction
          .insert(glossaryVersions)
          .values({
            contentFingerprint: input.contentFingerprint,
            version: (latest.version ?? 0) + 1,
            active: true,
          })
          .returning();
        const terms =
          input.terms.length === 0
            ? []
            : await transaction
                .insert(glossaryTerms)
                .values(
                  input.terms.map((term) => ({
                    glossaryVersionId: stored.id,
                    ...term,
                  })),
                )
                .returning({
                  id: glossaryTerms.id,
                  sourceTerm: glossaryTerms.sourceTerm,
                  normalizedTerm: glossaryTerms.normalizedTerm,
                });

        return {
          ...stored,
          terms: terms.sort((left, right) =>
            left.normalizedTerm.localeCompare(right.normalizedTerm),
          ),
        };
      });
    },

    async getActiveGlossary() {
      const stored = await db.query.glossaryVersions.findFirst({
        where: eq(glossaryVersions.active, true),
      });
      if (!stored) return null;

      return {
        ...stored,
        terms: await getGlossaryTerms(stored.id),
      };
    },
  };
}
