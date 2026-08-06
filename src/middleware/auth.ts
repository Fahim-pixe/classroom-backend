// middleware/auth.ts
import type { Request, Response, NextFunction } from "express";
import { auth } from "../lib/auth.js";
import type { User } from "../db/schema/index.js"; // Import the Drizzle type

// 1. Verify the session and inject the user into the request
export const requireAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const session = await auth.api.getSession({
      headers: req.headers,
    });

    if (!session || !session.user) {
      return res.status(401).json({ error: "Unauthorized: Please log in." });
    }

    // Safely cast the Better Auth user to your Drizzle database User type
    req.user = session.user as User;
    
    next();
  } catch (error) {
    console.error("Auth middleware error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// 2. Role-based Access Control (RBAC)
export const requireRole = (allowedRoles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const userRole = req.user?.role;

    if (!userRole || !allowedRoles.includes(userRole)) {
      return res.status(403).json({
        error: "Forbidden: You do not have permission to perform this action.",
      });
    }

    next();
  };
};