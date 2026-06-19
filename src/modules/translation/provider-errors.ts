export type ProviderFailureKind =
  | "configuration_error"
  | "transient_error"
  | "protocol_error";

export class ProviderCallError extends Error {
  constructor(
    readonly kind: ProviderFailureKind,
    readonly code: string,
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "ProviderCallError";
  }
}
