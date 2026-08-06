import express from "express";
import { and, desc, eq, getTableColumns, ilike, or, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { departments, subjects } from "../db/schema/index.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

// GET all subjects with optional search, filter, and pagination
router.get("/", async (req, res) => {
  try {
    const { search, department, page = 1, limit = 10 } = req.query;
    const currentPage = Math.max(1, parseInt(String(page), 10) || 1);
    const limitPerPage = Math.min(Math.max(1, parseInt(String(limit), 10) || 10), 100);
    const offset = (currentPage - 1) * limitPerPage;

    const filterConditions = [];
    if (search) {
      filterConditions.push(
        or(
            ilike(subjects.name, `%${search}%`),
            ilike(subjects.code, `%${search}%`),
        )
      );
    }
    if (department) {
      const departmentId = Number(department);
      if (!Number.isNaN(departmentId)) {
        filterConditions.push(eq(subjects.departmentId, departmentId));
      } else {
        const deptPattern = `%${String(department).replace(/[%_]/g, '\\$&')}%`;
        filterConditions.push(ilike(departments.name, deptPattern));
      }
    }

    const whereClause = filterConditions.length > 0 ? and(...filterConditions) : undefined;

    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(subjects)
      .leftJoin(departments, eq(subjects.departmentId, departments.id))
      .where(whereClause);
    const totalCount = countResult[0]?.count ?? 0;

    const subjectsList = await db
      .select({ ...getTableColumns(subjects), department: { ...getTableColumns(departments) } })
      .from(subjects)
      .leftJoin(departments, eq(subjects.departmentId, departments.id))
      .where(whereClause)
      .orderBy(desc(subjects.createdAt))
      .limit(limitPerPage)
      .offset(offset);

    res.status(200).json({
      data: subjectsList,
      pagination: {
        page: currentPage,
        limit: limitPerPage,
        total: totalCount,
        totalPages: Math.ceil(totalCount / limitPerPage),
      },
    });
  } catch (error) {
    console.error(`GET /subjects error: ${error}`);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// GET single subject
router.get("/:id", async (req, res) => {
  try {
    const subjectId = Number(req.params.id);
    if (!Number.isFinite(subjectId)) return res.status(400).json({ error: "Invalid subject id" });

    const [subject] = await db
      .select({ ...getTableColumns(subjects), department: { ...getTableColumns(departments) } })
      .from(subjects)
      .leftJoin(departments, eq(subjects.departmentId, departments.id))
      .where(eq(subjects.id, subjectId));

    if (!subject) return res.status(404).json({ error: "Subject not found" });
    res.status(200).json({ data: subject });
  } catch (error) {
    console.error("GET /subjects/:id error:", error);
    res.status(500).json({ error: "Failed to fetch subject" });
  }
});

// POST new subject
router.post("/", requireAuth, requireRole(["admin", "teacher"]), async (req, res) => {
  try {
    const { name, code, description, departmentId } = req.body;
    
    if (!name || !code || !departmentId) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const [createdSubject] = await db
      .insert(subjects)
      .values({ name, code, description, departmentId })
      .returning();

    if (!createdSubject) return res.status(500).json({ error: "Failed to create subject" });
    res.status(201).json({ data: createdSubject });
  } catch (error) {
    console.error("POST /subjects error:", error);
    res.status(500).json({ error: "Failed to create subject" });
  }
});

// PUT update subject
router.put("/:id", requireAuth, requireRole(["admin", "teacher"]), async (req, res) => {
  try {
    const subjectId = Number(req.params.id);
    if (!Number.isFinite(subjectId)) return res.status(400).json({ error: "Invalid subject id" });

    const { name, code, description, departmentId } = req.body;

    const [updatedSubject] = await db
      .update(subjects)
      .set({ name, code, description, departmentId })
      .where(eq(subjects.id, subjectId))
      .returning();

    if (!updatedSubject) return res.status(404).json({ error: "Subject not found" });
    res.status(200).json({ data: updatedSubject });
  } catch (error) {
    console.error("PUT /subjects/:id error:", error);
    res.status(500).json({ error: "Failed to update subject" });
  }
});

// DELETE subject
router.delete("/:id", requireAuth, requireRole(["admin", "teacher"]), async (req, res) => {
  try {
    const subjectId = Number(req.params.id);
    if (!Number.isFinite(subjectId)) return res.status(400).json({ error: "Invalid subject id" });

    const [deletedSubject] = await db
      .delete(subjects)
      .where(eq(subjects.id, subjectId))
      .returning({ id: subjects.id });

    if (!deletedSubject) return res.status(404).json({ error: "Subject not found" });
    res.status(200).json({ data: deletedSubject, message: "Subject deleted successfully" });
  } catch (error) {
    console.error("DELETE /subjects/:id error:", error);
    res.status(500).json({ error: "Failed to delete subject" });
  }
});

export default router;