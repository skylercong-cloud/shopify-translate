import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

import { z } from "zod";

const ALGORITHM = "aes-256-gcm";
const ENVELOPE_AAD = Buffer.from(
  "shopify-docs-translation-secret:v1:aes-256-gcm",
  "utf8",
);
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const MASTER_KEY_BYTES = 32;
const MASTER_KEY_ERROR =
  "MODEL_KEY_ENCRYPTION_KEY must be a base64-encoded 32-byte key";
const ENVELOPE_ERROR = "Encrypted secret is invalid";

const envelopeSchema = z
  .object({
    version: z.literal(1),
    algorithm: z.literal(ALGORITHM),
    iv: z.string().min(1),
    ciphertext: z.string().min(1),
    authTag: z.string().min(1),
  })
  .strict();

type EncryptedSecretEnvelope = z.infer<typeof envelopeSchema>;

function decodeCanonicalBase64(
  value: string,
  expectedBytes?: number,
): Buffer | null {
  if (
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  ) {
    return null;
  }

  const decoded = Buffer.from(value, "base64");
  if (
    decoded.toString("base64") !== value ||
    (expectedBytes !== undefined && decoded.length !== expectedBytes)
  ) {
    return null;
  }

  return decoded;
}

function assertMasterKey(masterKey: Buffer): void {
  if (masterKey.length !== MASTER_KEY_BYTES) {
    throw new Error(MASTER_KEY_ERROR);
  }
}

export function decodeMasterKey(encoded: string): Buffer {
  const decoded = decodeCanonicalBase64(encoded, MASTER_KEY_BYTES);
  if (!decoded) {
    throw new Error(MASTER_KEY_ERROR);
  }

  return decoded;
}

export function encryptSecret(
  plaintext: string,
  masterKey: Buffer,
): string {
  assertMasterKey(masterKey);
  if (plaintext.trim().length === 0) {
    throw new Error("Secret must not be empty");
  }

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, masterKey, iv, {
    authTagLength: AUTH_TAG_BYTES,
  });
  cipher.setAAD(ENVELOPE_AAD);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const envelope: EncryptedSecretEnvelope = {
    version: 1,
    algorithm: ALGORITHM,
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };

  return JSON.stringify(envelope);
}

export function decryptSecret(
  envelopeJson: string,
  masterKey: Buffer,
): string {
  try {
    assertMasterKey(masterKey);
    const envelope = envelopeSchema.parse(JSON.parse(envelopeJson));
    const iv = decodeCanonicalBase64(envelope.iv, IV_BYTES);
    const ciphertext = decodeCanonicalBase64(envelope.ciphertext);
    const authTag = decodeCanonicalBase64(
      envelope.authTag,
      AUTH_TAG_BYTES,
    );
    if (!iv || !ciphertext || ciphertext.length === 0 || !authTag) {
      throw new Error(ENVELOPE_ERROR);
    }

    const decipher = createDecipheriv(ALGORITHM, masterKey, iv, {
      authTagLength: AUTH_TAG_BYTES,
    });
    decipher.setAAD(ENVELOPE_AAD);
    decipher.setAuthTag(authTag);

    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error(ENVELOPE_ERROR);
  }
}
