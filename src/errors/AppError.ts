export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
    public retryable = false,
    public internalContext?: { courierRequest?: unknown; courierResponse?: unknown }
  ) {
    super(message);
    this.name = "AppError";
  }
}
