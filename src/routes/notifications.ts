import express, { type Request, type Response } from "express";
import { eq } from "drizzle-orm";

import {
  NOTIFICATION_CONFIG,
  NOTIFICATION_ROUTE_PATHS,
} from "../config/app.js";
import { db } from "../db/index.js";
import {
  notificationPreferences,
  type CalendarEventType,
  type NotificationEventPreferenceMap,
} from "../db/schema/index.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

const eventTypes = NOTIFICATION_CONFIG.defaultInAppPreferences;
const eventTypeKeys = Object.keys(eventTypes) as CalendarEventType[];

const preferenceDefaults = () => ({
  inAppPreferences: { ...NOTIFICATION_CONFIG.defaultInAppPreferences } as NotificationEventPreferenceMap,
  emailPreferences: { ...NOTIFICATION_CONFIG.defaultEmailPreferences } as NotificationEventPreferenceMap,
});

const normalizePreferences = (
  value: unknown,
  defaults: NotificationEventPreferenceMap,
): NotificationEventPreferenceMap | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const candidate = value as Record<string, unknown>;
  const unknownKey = Object.keys(candidate).find((key) => !eventTypeKeys.includes(key as CalendarEventType));
  if (unknownKey) return null;

  return eventTypeKeys.reduce<NotificationEventPreferenceMap>(
    (normalized, eventType) => ({
      ...normalized,
      [eventType]: typeof candidate[eventType] === "boolean" ? candidate[eventType] : defaults[eventType],
    }),
    { ...defaults },
  );
};

router.get(NOTIFICATION_ROUTE_PATHS.preferences, requireAuth, async (req: Request, res: Response) => {
  try {
    const viewer = req.user;
    if (!viewer) return res.status(401).json({ error: "Unauthorized" });

    const [savedPreferences] = await db
      .select({
        inAppPreferences: notificationPreferences.inAppPreferences,
        emailPreferences: notificationPreferences.emailPreferences,
      })
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, viewer.id))
      .limit(1);

    return res.status(200).json({ data: savedPreferences ?? preferenceDefaults() });
  } catch (error) {
    console.error("GET /notifications/preferences error:", error);
    return res.status(500).json({ error: "Failed to load notification preferences" });
  }
});

router.put(NOTIFICATION_ROUTE_PATHS.preferences, requireAuth, async (req: Request, res: Response) => {
  try {
    const viewer = req.user;
    if (!viewer) return res.status(401).json({ error: "Unauthorized" });

    const defaults = preferenceDefaults();
    const inAppPreferences = normalizePreferences(req.body?.inAppPreferences, defaults.inAppPreferences);
    const emailPreferences = normalizePreferences(req.body?.emailPreferences, defaults.emailPreferences);
    if (!inAppPreferences || !emailPreferences) {
      return res.status(400).json({ error: "Notification preferences must contain boolean values for supported event types" });
    }

    const [savedPreferences] = await db
      .insert(notificationPreferences)
      .values({ userId: viewer.id, inAppPreferences, emailPreferences })
      .onConflictDoUpdate({
        target: notificationPreferences.userId,
        set: { inAppPreferences, emailPreferences, updatedAt: new Date() },
      })
      .returning({
        inAppPreferences: notificationPreferences.inAppPreferences,
        emailPreferences: notificationPreferences.emailPreferences,
      });

    return res.status(200).json({ data: savedPreferences });
  } catch (error) {
    console.error("PUT /notifications/preferences error:", error);
    return res.status(500).json({ error: "Failed to save notification preferences" });
  }
});

export default router;
