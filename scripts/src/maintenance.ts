import { pool } from "@workspace/db";
await pool.query("DELETE FROM orbit_sessions WHERE expires_at<now()");
await pool.query("DELETE FROM orbit_rate_limits WHERE expires_at<now()");
console.log("Expired security records removed; tickets and files retained.");
await pool.end();
