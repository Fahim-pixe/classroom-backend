import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { SERVER_CONFIG } from "../config/app.js";

const millisecondsPerNanosecond = 1_000_000;
const durationPrecision = 10;

const roundDuration = (durationMilliseconds: number) =>
  Math.round(durationMilliseconds * durationPrecision) / durationPrecision;

const getDurationMilliseconds = (startedAt: bigint) =>
  Number(process.hrtime.bigint() - startedAt) / millisecondsPerNanosecond;

/**
 * Emits one structured operational event per completed request. It deliberately
 * excludes request bodies, query strings, authentication data, and user data.
 */
export const requestMonitoring = (req: Request, res: Response, next: NextFunction) => {
  if (!SERVER_CONFIG.monitoring.enabled) {
    return next();
  }

  const requestId = randomUUID();
  const startedAt = process.hrtime.bigint();

  req.requestId = requestId;
  res.setHeader(SERVER_CONFIG.monitoring.requestIdHeader, requestId);

  res.on("finish", () => {
    const durationMilliseconds = roundDuration(getDurationMilliseconds(startedAt));
    const isServerError = res.statusCode >= 500;
    const isSlow = durationMilliseconds >= SERVER_CONFIG.monitoring.slowRequestThresholdMilliseconds;


    console.log(
      JSON.stringify({
        event: isServerError
          ? SERVER_CONFIG.monitoring.eventNames.requestFailed
          : SERVER_CONFIG.monitoring.eventNames.requestCompleted,
        requestId,
        method: req.method,
        statusCode: res.statusCode,
        durationMilliseconds,
        isSlow,
      }),
    );
  });

  return next();
};
