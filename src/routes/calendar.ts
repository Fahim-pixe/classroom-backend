import express, { type Request, type Response } from "express";
import { and, asc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";

import {
  CALENDAR_CONFIG,
  CALENDAR_ROUTE_PATHS,
} from "../config/app.js";
import { db } from "../db/index.js";
import {
  assignments,
  calendarEvents,
  classes,
  enrollments,
  subjects,
  type CalendarEventType,
} from "../db/schema/index.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

type Viewer = NonNullable<Request["user"]>;
type ScheduleEntry = {
  day?: string;
  startTime?: string;
  endTime?: string;
  room?: string;
  location?: string;
};

type AccessibleClass = {
  id: number;
  name: string;
  schedules: ScheduleEntry[];
  subjectName: string;
  subjectCode: string;
};

type CalendarViewEvent = {
  id: string;
  sourceEventId?: number;
  source: "calendar" | "assignment" | "class_session";
  classId: number | null;
  className: string | null;
  subjectName: string | null;
  subjectCode: string | null;
  title: string;
  description: string | null;
  type: CalendarEventType;
  startAt: string;
  endAt: string;
  isAllDay: boolean;
  recurrence: string;
  canManage: boolean;
};

type CalendarRange = { start: Date; end: Date };

const idOf = (value: unknown) => {
  const numericValue = Number(value);
  return Number.isInteger(numericValue) && numericValue > 0 ? numericValue : null;
};

const dateOf = (value: unknown) => {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const toDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const getMonday = (date: Date) => {
  const weekStart = new Date(date);
  weekStart.setHours(0, 0, 0, 0);
  const offset = (weekStart.getDay() - CALENDAR_CONFIG.weekStartsOn + 7) % 7;
  weekStart.setDate(weekStart.getDate() - offset);
  return weekStart;
};

const normalizeDay = (value?: string) => value?.trim().toLowerCase().slice(0, 3) ?? "";

const toIso = (date: Date) => date.toISOString();

const getRange = (query: Request["query"]): CalendarRange | null => {
  const defaultStart = getMonday(new Date());
  const defaultEnd = new Date(defaultStart);
  defaultEnd.setDate(defaultStart.getDate() + CALENDAR_CONFIG.weekdayNames.length - 1);
  defaultEnd.setHours(23, 59, 59, 999);

  const start = query.start ? dateOf(query.start) : defaultStart;
  const end = query.end ? dateOf(query.end) : defaultEnd;
  if (!start || !end || end < start) return null;

  const rangeDays = (end.getTime() - start.getTime()) / CALENDAR_CONFIG.validation.millisecondsPerDay;
  if (rangeDays > CALENDAR_CONFIG.validation.maximumRangeDays) return null;
  return { start, end };
};

const getAccessibleClasses = async (viewer: Viewer): Promise<AccessibleClass[]> => {
  const classFields = {
    id: classes.id,
    name: classes.name,
    schedules: classes.schedules,
    subjectName: subjects.name,
    subjectCode: subjects.code,
  };

  const rows = viewer.role === "admin"
    ? await db.select(classFields).from(classes).innerJoin(subjects, eq(subjects.id, classes.subjectId)).orderBy(asc(classes.name))
    : viewer.role === "teacher"
      ? await db.select(classFields).from(classes).innerJoin(subjects, eq(subjects.id, classes.subjectId)).where(eq(classes.teacherId, viewer.id)).orderBy(asc(classes.name))
      : await db.select(classFields).from(enrollments).innerJoin(classes, eq(classes.id, enrollments.classId)).innerJoin(subjects, eq(subjects.id, classes.subjectId)).where(and(eq(enrollments.studentId, viewer.id), eq(classes.status, "active"))).orderBy(asc(classes.name));

  return rows.map((row) => ({
    ...row,
    schedules: Array.isArray(row.schedules) ? row.schedules as ScheduleEntry[] : [],
  }));
};

const canManageClass = async (classId: number, viewer: Viewer) => {
  if (viewer.role === "admin") return true;
  if (viewer.role !== "teacher") return false;
  const [classRecord] = await db
    .select({ teacherId: classes.teacherId })
    .from(classes)
    .where(eq(classes.id, classId))
    .limit(1);
  return classRecord?.teacherId === viewer.id;
};

const classSessionEvents = (
  accessibleClasses: AccessibleClass[],
  range: CalendarRange,
): CalendarViewEvent[] => {
  const events: CalendarViewEvent[] = [];
  const cursor = new Date(range.start);
  cursor.setHours(0, 0, 0, 0);

  while (cursor <= range.end) {
    const dayName = CALENDAR_CONFIG.weekdayNames[cursor.getDay()];
    const date = toDateKey(cursor);
    for (const classRecord of accessibleClasses) {
      for (const schedule of classRecord.schedules) {
        if (
          normalizeDay(schedule.day) !== normalizeDay(dayName)
          || !schedule.startTime
          || !schedule.endTime
        ) continue;

        events.push({
          id: `class-session-${classRecord.id}-${date}-${schedule.startTime}`,
          source: "class_session",
          classId: classRecord.id,
          className: classRecord.name,
          subjectName: classRecord.subjectName,
          subjectCode: classRecord.subjectCode,
          title: `${classRecord.subjectCode} · ${classRecord.name}`,
          description: schedule.room ?? schedule.location ?? null,
          type: "class_session",
          startAt: `${date}T${schedule.startTime}:00`,
          endAt: `${date}T${schedule.endTime}:00`,
          isAllDay: false,
          recurrence: "weekly",
          canManage: false,
        });
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return events;
};

const expandCalendarEvent = (
  event: {
    id: number;
    classId: number | null;
    className: string | null;
    subjectName: string | null;
    subjectCode: string | null;
    title: string;
    description: string | null;
    type: CalendarEventType;
    startAt: Date;
    endAt: Date;
    isAllDay: boolean;
    recurrence: string;
    createdBy: string;
  },
  range: CalendarRange,
  viewer: Viewer,
): CalendarViewEvent[] => {
  const duration = event.endAt.getTime() - event.startAt.getTime();
  const instances: CalendarViewEvent[] = [];
  const occurrence = new Date(event.startAt);
  let count = 0;

  if (event.recurrence === "weekly") {
    const weeklyInterval = CALENDAR_CONFIG.validation.millisecondsPerDay * CALENDAR_CONFIG.weekdayNames.length;
    const steps = Math.max(0, Math.floor((range.start.getTime() - occurrence.getTime()) / weeklyInterval));
    occurrence.setTime(occurrence.getTime() + steps * weeklyInterval);
    while (occurrence.getTime() + duration < range.start.getTime()) occurrence.setTime(occurrence.getTime() + weeklyInterval);
  } else if (event.recurrence === "monthly") {
    while (occurrence.getTime() + duration < range.start.getTime() && count < CALENDAR_CONFIG.validation.maximumRecurrenceOccurrences) {
      occurrence.setMonth(occurrence.getMonth() + 1);
      count += 1;
    }
  }

  while (occurrence <= range.end && count < CALENDAR_CONFIG.validation.maximumRecurrenceOccurrences) {
    const occurrenceEnd = new Date(occurrence.getTime() + duration);
    if (occurrenceEnd >= range.start) {
      instances.push({
        id: `calendar-${event.id}-${occurrence.toISOString()}`,
        sourceEventId: event.id,
        source: "calendar",
        classId: event.classId,
        className: event.className,
        subjectName: event.subjectName,
        subjectCode: event.subjectCode,
        title: event.title,
        description: event.description,
        type: event.type,
        startAt: toIso(occurrence),
        endAt: toIso(occurrenceEnd),
        isAllDay: event.isAllDay,
        recurrence: event.recurrence,
        canManage: viewer.role === "admin" || event.createdBy === viewer.id,
      });
    }

    if (event.recurrence === CALENDAR_CONFIG.defaultRecurrence) break;
    if (event.recurrence === "weekly") {
      occurrence.setDate(occurrence.getDate() + CALENDAR_CONFIG.weekdayNames.length);
    } else if (event.recurrence === "monthly") {
      occurrence.setMonth(occurrence.getMonth() + 1);
    } else {
      break;
    }
    count += 1;
  }

  return instances;
};

const getCalendarData = async (viewer: Viewer, range: CalendarRange) => {
  const accessibleClasses = await getAccessibleClasses(viewer);
  const classIds = accessibleClasses.map((classRecord) => classRecord.id);
  const classById = new Map(accessibleClasses.map((classRecord) => [classRecord.id, classRecord]));

  const assignmentRows = classIds.length
    ? await db
      .select({
        id: assignments.id,
        classId: assignments.classId,
        title: assignments.title,
        description: assignments.description,
        dueAt: assignments.dueAt,
      })
      .from(assignments)
      .where(and(inArray(assignments.classId, classIds), gte(assignments.dueAt, range.start), lte(assignments.dueAt, range.end)))
    : [];

  const eventScope = viewer.role === "admin"
    ? undefined
    : viewer.role === "teacher"
      ? classIds.length ? inArray(calendarEvents.classId, classIds) : eq(calendarEvents.createdBy, viewer.id)
      : classIds.length ? or(inArray(calendarEvents.classId, classIds), isNull(calendarEvents.classId)) : isNull(calendarEvents.classId);

  const persistedEventRows = await db
    .select({
      id: calendarEvents.id,
      classId: calendarEvents.classId,
      title: calendarEvents.title,
      description: calendarEvents.description,
      type: calendarEvents.type,
      startAt: calendarEvents.startAt,
      endAt: calendarEvents.endAt,
      createdBy: calendarEvents.createdBy,
      isAllDay: calendarEvents.isAllDay,
      recurrence: calendarEvents.recurrence,
      className: classes.name,
      subjectName: subjects.name,
      subjectCode: subjects.code,
    })
    .from(calendarEvents)
    .leftJoin(classes, eq(classes.id, calendarEvents.classId))
    .leftJoin(subjects, eq(subjects.id, classes.subjectId))
    .where(and(eventScope, lte(calendarEvents.startAt, range.end)));

  const assignmentEvents: CalendarViewEvent[] = assignmentRows.flatMap((assignment) => {
    if (!assignment.dueAt) return [];
    const classRecord = classById.get(assignment.classId);
    return [{
      id: `assignment-${assignment.id}`,
      source: "assignment" as const,
      classId: assignment.classId,
      className: classRecord?.name ?? null,
      subjectName: classRecord?.subjectName ?? null,
      subjectCode: classRecord?.subjectCode ?? null,
      title: assignment.title,
      description: assignment.description,
      type: "assignment_due" as const,
      startAt: toIso(assignment.dueAt),
      endAt: toIso(assignment.dueAt),
      isAllDay: false,
      recurrence: CALENDAR_CONFIG.defaultRecurrence,
      canManage: false,
    }];
  });

  const events = [
    ...classSessionEvents(accessibleClasses, range),
    ...assignmentEvents,
    ...persistedEventRows.flatMap((event) => expandCalendarEvent(event, range, viewer)),
  ].sort((first, second) => first.startAt.localeCompare(second.startAt));

  return { accessibleClasses, events };
};

const inputOf = (body: unknown) => {
  const value = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const title = typeof value.title === "string" ? value.title.trim() : "";
  const description = typeof value.description === "string" ? value.description.trim() : null;
  const type = typeof value.type === "string" ? value.type : CALENDAR_CONFIG.defaultEventType;
  const recurrence = typeof value.recurrence === "string" ? value.recurrence : CALENDAR_CONFIG.defaultRecurrence;
  const classId = value.classId === null || value.classId === undefined || value.classId === "" ? null : idOf(value.classId);
  const startAt = dateOf(value.startAt);
  const endAt = dateOf(value.endAt);
  const isAllDay = value.isAllDay === true;

  if (!title || title.length > CALENDAR_CONFIG.validation.maximumTitleLength) return null;
  if (description && description.length > CALENDAR_CONFIG.validation.maximumDescriptionLength) return null;
  if (!CALENDAR_CONFIG.eventTypes.includes(type as CalendarEventType)) return null;
  if (!CALENDAR_CONFIG.recurrenceValues.includes(recurrence as typeof CALENDAR_CONFIG.recurrenceValues[number])) return null;
  if (!startAt || !endAt || endAt < startAt) return null;
  if (value.classId !== null && value.classId !== undefined && value.classId !== "" && !classId) return null;

  return { title, description, type: type as CalendarEventType, recurrence, classId, startAt, endAt, isAllDay };
};

const canCreateType = (viewer: Viewer, type: CalendarEventType) => {
  if (viewer.role === "admin") return type === "exam" || type === "holiday" || type === "custom";
  return viewer.role === "teacher" && (type === "exam" || type === "custom");
};

router.get(CALENDAR_ROUTE_PATHS.accessibleClasses, requireAuth, async (req: Request, res: Response) => {
  try {
    const viewer = req.user;
    if (!viewer) return res.status(401).json({ error: "Unauthorized" });
    const data = await getAccessibleClasses(viewer);
    return res.status(200).json({ data });
  } catch (error) {
    console.error("GET /calendar/classes error:", error);
    return res.status(500).json({ error: "Failed to fetch available calendar classes" });
  }
});

router.get(CALENDAR_ROUTE_PATHS.root, requireAuth, async (req: Request, res: Response) => {
  try {
    const viewer = req.user;
    const range = getRange(req.query);
    if (!viewer) return res.status(401).json({ error: "Unauthorized" });
    if (!range) return res.status(400).json({ error: "Provide a valid date range within the calendar limit" });

    const { events } = await getCalendarData(viewer, range);
    return res.status(200).json({ data: { rangeStart: toIso(range.start), rangeEnd: toIso(range.end), events } });
  } catch (error) {
    console.error("GET /calendar error:", error);
    return res.status(500).json({ error: "Failed to load calendar events" });
  }
});

router.get(CALENDAR_ROUTE_PATHS.myWeek, requireAuth, async (req: Request, res: Response) => {
  try {
    const viewer = req.user;
    if (!viewer) return res.status(401).json({ error: "Unauthorized" });

    const weekStart = getMonday(new Date());
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + CALENDAR_CONFIG.weekdayNames.length - 1);
    weekEnd.setHours(23, 59, 59, 999);
    const { events } = await getCalendarData(viewer, { start: weekStart, end: weekEnd });
    const days = Array.from({ length: CALENDAR_CONFIG.weekdayNames.length }, (_, index) => {
      const date = new Date(weekStart);
      date.setDate(weekStart.getDate() + index);
      const dateKey = toDateKey(date);
      return { date: dateKey, day: CALENDAR_CONFIG.weekdayNames[date.getDay()], events: events.filter((event) => event.startAt.startsWith(dateKey)) };
    });

    return res.status(200).json({ data: { weekStart: toDateKey(weekStart), weekEnd: toDateKey(weekEnd), events, days } });
  } catch (error) {
    console.error("GET /calendar/my-week error:", error);
    return res.status(500).json({ error: "Failed to load your weekly schedule" });
  }
});

router.post(CALENDAR_ROUTE_PATHS.root, requireAuth, async (req: Request, res: Response) => {
  try {
    const viewer = req.user;
    const input = inputOf(req.body);
    if (!viewer) return res.status(401).json({ error: "Unauthorized" });
    if (!input || !canCreateType(viewer, input.type)) return res.status(400).json({ error: "Provide a valid calendar event" });
    if (viewer.role === "student") return res.status(403).json({ error: "Students cannot create calendar events" });
    if (viewer.role === "teacher" && (!input.classId || !(await canManageClass(input.classId, viewer)))) {
      return res.status(403).json({ error: "Teachers may only create events for their own classes" });
    }

    const [event] = await db.insert(calendarEvents).values({ ...input, createdBy: viewer.id }).returning();
    return res.status(201).json({ data: event });
  } catch (error) {
    console.error("POST /calendar error:", error);
    return res.status(500).json({ error: "Failed to create calendar event" });
  }
});

router.put(CALENDAR_ROUTE_PATHS.eventById, requireAuth, async (req: Request, res: Response) => {
  try {
    const viewer = req.user;
    const eventId = idOf(req.params.id);
    const input = inputOf(req.body);
    if (!viewer) return res.status(401).json({ error: "Unauthorized" });
    if (!eventId || !input || !canCreateType(viewer, input.type)) return res.status(400).json({ error: "Provide a valid calendar event" });

    const [existingEvent] = await db.select().from(calendarEvents).where(eq(calendarEvents.id, eventId)).limit(1);
    if (!existingEvent) return res.status(404).json({ error: "Calendar event not found" });
    if (viewer.role !== "admin" && (existingEvent.createdBy !== viewer.id || !input.classId || !(await canManageClass(input.classId, viewer)))) {
      return res.status(403).json({ error: "You cannot update this calendar event" });
    }

    const [event] = await db.update(calendarEvents).set({ ...input, updatedAt: new Date() }).where(eq(calendarEvents.id, eventId)).returning();
    return res.status(200).json({ data: event });
  } catch (error) {
    console.error("PUT /calendar/:id error:", error);
    return res.status(500).json({ error: "Failed to update calendar event" });
  }
});

router.delete(CALENDAR_ROUTE_PATHS.eventById, requireAuth, async (req: Request, res: Response) => {
  try {
    const viewer = req.user;
    const eventId = idOf(req.params.id);
    if (!viewer) return res.status(401).json({ error: "Unauthorized" });
    if (!eventId) return res.status(400).json({ error: "A valid calendar event id is required" });

    const [existingEvent] = await db.select().from(calendarEvents).where(eq(calendarEvents.id, eventId)).limit(1);
    if (!existingEvent) return res.status(404).json({ error: "Calendar event not found" });
    if (viewer.role !== "admin" && (existingEvent.createdBy !== viewer.id || !existingEvent.classId || !(await canManageClass(existingEvent.classId, viewer)))) {
      return res.status(403).json({ error: "You cannot delete this calendar event" });
    }

    await db.delete(calendarEvents).where(eq(calendarEvents.id, eventId));
    return res.status(204).send();
  } catch (error) {
    console.error("DELETE /calendar/:id error:", error);
    return res.status(500).json({ error: "Failed to delete calendar event" });
  }
});

export default router;
