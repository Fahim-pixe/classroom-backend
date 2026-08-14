import { Router } from "express";
import { MONITORING_ROUTE_PATHS, SERVER_CONFIG } from "../config/app.js";

const monitoringRouter = Router();

const allowedMetricNames = new Set<string>(SERVER_CONFIG.monitoring.webVitalMetricNames);
const allowedRatings = new Set<string>(SERVER_CONFIG.monitoring.webVitalRatings);
const valuePrecision = 100;

type WebVitalPayload = {
  name?: unknown;
  value?: unknown;
  rating?: unknown;
};

type ValidWebVitalPayload = {
  name: string;
  value: number;
  rating: string;
};

const isValidWebVital = (payload: WebVitalPayload): payload is ValidWebVitalPayload =>
  typeof payload.name === "string" &&
  allowedMetricNames.has(payload.name) &&
  typeof payload.rating === "string" &&
  allowedRatings.has(payload.rating) &&
  typeof payload.value === "number" &&
  Number.isFinite(payload.value) &&
  payload.value >= 0 &&
  payload.value <= SERVER_CONFIG.monitoring.webVitalMaximumValue;

monitoringRouter.post(MONITORING_ROUTE_PATHS.webVitals, (req, res) => {
  const payload = req.body as WebVitalPayload;

  if (!isValidWebVital(payload)) {
    return res.status(400).json({ error: SERVER_CONFIG.genericErrorMessage });
  }

  console.log(
    JSON.stringify({
      event: SERVER_CONFIG.monitoring.eventNames.webVitalReceived,
      metricName: payload.name,
      metricValue: Math.round(payload.value * valuePrecision) / valuePrecision,
      rating: payload.rating,
      requestId: req.requestId,
    }),
  );

  return res.status(204).end();
});

export default monitoringRouter;
