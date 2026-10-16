import { ErrorRequestHandler, Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { AppError } from "./AppError";
import { logger } from "../logger";

export function notFound(req: Request, _res: Response, next: NextFunction) {
  next(new AppError(404, "ROUTE_NOT_FOUND", `Route ${req.method} ${req.path} was not found`));
}

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  const requestId = String(res.locals.requestId ?? req.headers["x-request-id"] ?? "unknown");
  const body = req.body as any;
  const logContext = {
    requestId,
    orderId: body?.order_id ?? body?.orders?.map((order: any) => order.order_id) ?? req.params.orderId,
    courierPartner: body?.courier_partner ?? body?.orders?.map((order: any) => order.courier_partner)
  };
  const bodyError = error as Error & { status?: number; type?: string };
  if (bodyError.type === "entity.parse.failed" || bodyError.type === "entity.too.large") {
    const tooLarge = bodyError.type === "entity.too.large";
    const statusCode = tooLarge ? 413 : 400;
    logger.warn({ ...logContext, err: error }, "Request body rejected");
    res.status(statusCode).json({
      success: false,
      error: {
        code: tooLarge ? "REQUEST_TOO_LARGE" : "VALIDATION_ERROR",
        message: tooLarge ? "Request body exceeds the 1 MB limit" : "Request body must be valid JSON",
        ...(!tooLarge ? { details: [{ field: "body", message: "Request body must be valid JSON" }] } : {})
      },
      request_id: requestId
    });
    return;
  }
  if (error instanceof ZodError) {
    logger.warn({ ...logContext, err: error }, "Request validation failed");
    res.status(400).json({
      success: false, error: {
        code: "VALIDATION_ERROR", message: "Request validation failed",
        details: error.issues.map(i => ({ field: i.path.join("."), message: i.message }))
      }, request_id: requestId
    });
    return;
  }
  const appError = error instanceof AppError ? error : new AppError(500, "INTERNAL_ERROR", "An unexpected error occurred");
  logger[appError.statusCode >= 500 ? "error" : "warn"]({
    err: error,
    ...logContext,
    path: req.path,
    errorType: appError.code
  }, "Request failed");
  res.status(appError.statusCode).json({
    success: false,
    error: { code: appError.code, message: appError.message, ...(appError.details ? { details: appError.details } : {}) },
    request_id: requestId
  });
};
