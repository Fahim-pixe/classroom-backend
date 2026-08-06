import express from "express";
import { and, eq, getTableColumns, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { classes, departments, enrollments, subjects, user } from "../db/schema/index.js";

const router = express.Router();

const getEnrollmentDetails = async (enrollmentId: number) => {
  const [enrollment] = await db
    .select({
      ...getTableColumns(enrollments),
      class: {
        ...getTableColumns(classes),
      },
      subject: {
        ...getTableColumns(subjects),
      },
      department: {
        ...getTableColumns(departments),
      },
      teacher: {
        ...getTableColumns(user),
      },
    })
    .from(enrollments)
    .leftJoin(classes, eq(enrollments.classId, classes.id))
    .leftJoin(subjects, eq(classes.subjectId, subjects.id))
    .leftJoin(departments, eq(subjects.departmentId, departments.id))
    .leftJoin(user, eq(classes.teacherId, user.id))
    .where(eq(enrollments.id, enrollmentId));

  return enrollment;
};

// Create enrollment (Protected by transaction and capacity check)
router.post("/", async (req, res) => {
  try {
    const { classId, studentId } = req.body;
    const parsedClassId = Number(classId);
    if (!Number.isInteger(parsedClassId) || parsedClassId <= 0 || typeof studentId !== "string" || !studentId.trim()) {
      return res.status(400).json({ error: "A valid classId and studentId are required" });
    }

    // Use a database transaction to prevent race conditions
    const createdEnrollmentId = await db.transaction(async (tx) => {
      const [classRecord] = await tx.select().from(classes).where(eq(classes.id, parsedClassId));
      if (!classRecord) throw new Error("Class not found");
      if (classRecord.status !== "active") throw new Error("Class is not active");

      const [student] = await tx.select().from(user).where(eq(user.id, studentId.trim()));
      if (!student) throw new Error("Student not found");

      const [existingEnrollment] = await tx
        .select({ id: enrollments.id })
        .from(enrollments)
        .where(and(eq(enrollments.classId, parsedClassId), eq(enrollments.studentId, studentId.trim())));
      if (existingEnrollment) throw new Error("Student already enrolled");

      // Enforce Capacity
      const [currentEnrollments] = await tx
        .select({ count: sql<number>`count(*)` })
        .from(enrollments)
        .where(eq(enrollments.classId, parsedClassId));
      
      if (classRecord.capacity <= 0 || Number(currentEnrollments?.count ?? 0) >= classRecord.capacity) {
        throw new Error("Class is at full capacity");
      }

      const [newEnrollment] = await tx
        .insert(enrollments)
        .values({ classId: parsedClassId, studentId: studentId.trim() })
        .returning({ id: enrollments.id });

      // TypeScript safety check
      if (!newEnrollment) {
        throw new Error("Failed to create enrollment record");
      }

      return newEnrollment.id;
    });

    const enrollment = await getEnrollmentDetails(createdEnrollmentId);
    res.status(201).json({ data: enrollment });
  } catch (error: any) {
    const message = error instanceof Error ? error.message : "Failed to create enrollment";
    const status = message.includes("not found") ? 404 : message.includes("capacity") || message.includes("enrolled") ? 409 : 500;
    res.status(status).json({ error: message });
  }
});

// Join class by invite code (Protected by transaction and capacity check)
router.post("/join", async (req, res) => {
  try {
    const { inviteCode, studentId } = req.body;
    const normalizedInviteCode = typeof inviteCode === "string" ? inviteCode.trim() : "";
    if (!normalizedInviteCode || typeof studentId !== "string" || !studentId.trim()) {
      return res.status(400).json({ error: "A valid inviteCode and studentId are required" });
    }

    const createdEnrollmentId = await db.transaction(async (tx) => {
      const [classRecord] = await tx.select().from(classes).where(eq(classes.inviteCode, normalizedInviteCode));
      if (!classRecord) throw new Error("Class not found");
      if (classRecord.status !== "active") throw new Error("Class is not active");

      const [student] = await tx.select().from(user).where(eq(user.id, studentId.trim()));
      if (!student) throw new Error("Student not found");

      const [existingEnrollment] = await tx
        .select({ id: enrollments.id })
        .from(enrollments)
        .where(and(eq(enrollments.classId, classRecord.id), eq(enrollments.studentId, studentId.trim())));
      if (existingEnrollment) throw new Error("Student already enrolled");

      // Enforce Capacity
      const [currentEnrollments] = await tx
        .select({ count: sql<number>`count(*)` })
        .from(enrollments)
        .where(eq(enrollments.classId, classRecord.id));
      
      if (classRecord.capacity <= 0 || Number(currentEnrollments?.count ?? 0) >= classRecord.capacity) {
        throw new Error("Class is at full capacity");
      }

      const [newEnrollment] = await tx
        .insert(enrollments)
        .values({ classId: classRecord.id, studentId: studentId.trim() })
        .returning({ id: enrollments.id });

      // TypeScript safety check
      if (!newEnrollment) {
        throw new Error("Failed to create enrollment record");
      }

      return newEnrollment.id;
    });

    const enrollment = await getEnrollmentDetails(createdEnrollmentId);
    res.status(201).json({ data: enrollment });
  } catch (error: any) {
    const message = error instanceof Error ? error.message : "Failed to join class";
    const status = message.includes("not found") ? 404 : message.includes("capacity") || message.includes("enrolled") ? 409 : 500;
    res.status(status).json({ error: message });
  }
});

// Unenroll a student from a class
router.delete("/:classId", async (req, res) => {
  try {
    const classId = Number(req.params.classId);
    const studentId = req.user?.id; // Extracted safely from Phase 1 middleware

    if (!studentId || !Number.isFinite(classId)) {
      return res.status(400).json({ error: "Invalid class or user session" });
    }

    const [deleted] = await db
      .delete(enrollments)
      .where(and(eq(enrollments.classId, classId), eq(enrollments.studentId, studentId)))
      .returning({ id: enrollments.id });

    if (!deleted) return res.status(404).json({ error: "Enrollment not found" });

    res.status(200).json({ data: deleted, message: "Successfully unenrolled" });
  } catch (error) {
    console.error("DELETE /enrollments error:", error);
    res.status(500).json({ error: "Failed to unenroll" });
  }
});

export default router;