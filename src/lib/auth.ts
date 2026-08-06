import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

import { db } from "../db/index.js"; // your drizzle instance
import * as schema from "../db/schema/auth.js";

const frontendUrl = process.env.FRONTEND_URL?.replace(/\/$/, "");
const betterAuthSecret = process.env.BETTER_AUTH_SECRET;

if (!betterAuthSecret) {
  throw new Error("BETTER_AUTH_SECRET is not defined");
}

export const auth = betterAuth({
  secret: betterAuthSecret,
  trustedOrigins: [frontendUrl, process.env.BETTER_AUTH_URL]
    .filter((origin): origin is string => Boolean(origin))
    .map((origin) => origin.replace(/\/$/, "")),
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  emailAndPassword: {
    enabled: true,
  },
  user: {
    additionalFields: {
      role: {
        type: "string",
        required: true,
        defaultValue: "student",
        input: true, // Allow role to be set during registration
      },
      imageCldPubId: {
        type: "string",
        required: false,
        input: true, // Allow imageCldPubId to be set during registration
      },
    },
  },
});