import express, { type Request, type Response } from "express";
import { and, asc, eq } from "drizzle-orm";

import { db } from "../db/index.js";
import { classes, enrollments, subjects } from "../db/schema/index.js";
import { requireAuth } from "../middleware/auth.js";
import { CALENDAR_CONFIG } from "../config/app.js";

const router = express.Router();

type ScheduleEntry = {
  day?: string;
  startTime?: string;
  endTime?: string;
  room?: string;
  location?: string;
};

type WeekEvent = {
  id: string;
  date: string;
  day: string;
  startTime: string;
  endTime: string;
  room: string | null;
  classId: number;
  className: string;
  subjectName: string;
  subjectCode: string;
};

const getMonday = (date: Date) => {
  const weekStart = new Date(date);
  weekStart.setHours(0, 0, 0, 0);
  const offset = (weekStart.getDay() - CALENDAR_CONFIG.weekStartsOn + 7) % 7;
  weekStart.setDate(weekStart.getDate() - offset);
  return weekStart;
};

const toDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const normalizeDay = (value?: string) => value?.trim().toLowerCase().slice(0, 3) ?? "";

router.get("/my-week", requireAuth, async (req: Request, res: Response) => {
  try {
    const currentUser = req.user;
    if (!currentUser) return res.status(401).json({ error: "Unauthorized" });

    const baseQuery = db
      .select({
        id: classes.id,
        name: classes.name,
        schedules: classes.schedules,
        subjectName: subjects.name,
        subjectCode: subjects.code,
      })
      .from(classes)
      .innerJoin(subjects, eq(classes.subjectId, subjects.id));

    const accessibleClasses =
      currentUser.role === "admin"
        ? await baseQuery.orderBy(asc(classes.name))
        : currentUser.role === "teacher"
          ? await baseQuery.where(eq(classes.teacherId, currentUser.id)).orderBy(asc(classes.name))
          : await baseQuery
              .innerJoin(enrollments, eq(enrollments.classId, classes.id))
              .where(and(eq(enrollments.studentId, currentUser.id), eq(classes.status, "active")))
              .orderBy(asc(classes.name));

    const weekStart = getMonday(new Date());
    const days = Array.from({ length: CALENDAR_CONFIG.weekdayNames.length }, (_, index) => {
      const date = new Date(weekStart);
      date.setDate(weekStart.getDate() + index);
      return {
        date: toDateKey(date),
        day: CALENDAR_CONFIG.weekdayNames[date.getDay()],
        events: [] as WeekEvent[],
      };
    });

    const events: WeekEvent[] = [];
    for (const classRecord of accessibleClasses) {
      const schedules = Array.isArray(classRecord.schedules)
        ? (classRecord.schedules as ScheduleEntry[])
        : [];

      for (const schedule of schedules) {
        const weekday = normalizeDay(schedule.day);
        const targetDay = days.find((day) => normalizeDay(day.day) === weekday);
        if (!targetDay?.day || !schedule.startTime || !schedule.endTime) continue;

        events.push({
          id: `${classRecord.id}-${targetDay.date}-${schedule.startTime}`,
          date: targetDay.date,
          day: targetDay.day,
          startTime: schedule.startTime,
          endTime: schedule.endTime,
          room: schedule.room ?? schedule.location ?? null,
          classId: classRecord.id,
          className: classRecord.name,
          subjectName: classRecord.subjectName,
          subjectCode: classRecord.subjectCode,
        });
      }
    }

    events.sort((first, second) =>
      `${first.date}-${first.startTime}`.localeCompare(`${second.date}-${second.startTime}`)
    );

    const dayMap = new Map(days.map((day) => [day.date, day]));
    for (const event of events) dayMap.get(event.date)?.events.push(event);

    return res.status(200).json({
      data: {
        weekStart: toDateKey(weekStart),
        weekEnd: days[days.length - 1]?.date,
        events,
        days,
      },
    });
  } catch (error) {
    console.error("GET /calendar/my-week error:", error);
    return res.status(500).json({ error: "Failed to load your weekly schedule" });
  }
});

export default router;
