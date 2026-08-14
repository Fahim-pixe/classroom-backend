// express.d.ts
import type { User } from "./db/schema/index.js";

declare global {
  namespace Express {
    interface Request {
      user?: User;
      requestId?: string;
    }
  }
}
export {};