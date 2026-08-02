import express from "express";
import { departments, subjects } from "../db/schema/index.ts";
import { and, ilike, or } from "drizzle-orm/sql/expressions/conditions";
import { db } from "../db/index.ts";
import { sql } from "drizzle-orm/sql/sql";
import { desc, eq, getTableColumns } from "drizzle-orm";


const router = express.Router();

// Get all subjects with optional search, filter, and pagination
router.get("/", async (req, res) => {
  try {
    // Implement logic to fetch subjects from the database
    const { search, department, page = 1, limit = 10 } = req.query;

    const currentPage = Math.max(1, +page);
    const limitPerPage = Math.max(1, +limit);  

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

export default router;