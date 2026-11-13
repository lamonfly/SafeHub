import { sql } from "drizzle-orm";
import { connection } from "next/server";
import { db } from "@/db";

// Unauthenticated liveness check for the Docker healthcheck. Reveals nothing
// except whether the server and database respond.
export async function GET() {
  await connection();
  try {
    db.run(sql`select 1`);
    return Response.json({ status: "ok" });
  } catch {
    return Response.json({ status: "error" }, { status: 503 });
  }
}
