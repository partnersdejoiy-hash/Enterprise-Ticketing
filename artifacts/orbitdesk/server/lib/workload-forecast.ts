/**
 * Orbit Workload Forecasting (Superpower #27).
 *
 * Predicts next-7-day ticket volume per department from 90 days of real
 * history using a 7-day moving average. Confidence derives from variance:
 * high variance -> low confidence. Probabilistic language only — forecasts
 * are possibilities, never facts.
 *
 * Results are persisted to workload_predictions (upsert per dept/day).
 */

import { pool } from "@workspace/db";
import { resolveTenantId } from "./exec-brief.js";

export type ForecastConfidence = "low" | "medium" | "high";

export interface DailyVolume {
  date: string; // YYYY-MM-DD
  volume: number;
}

export interface DayForecast {
  date: string;
  predictedVolume: number;
  confidence: ForecastConfidence;
  /** The 7 daily volumes the average was taken over. */
  basis: DailyVolume[];
}

export interface DepartmentForecast {
  departmentId: number | null;
  departmentName: string;
  forecast: DayForecast[];
  history: DailyVolume[]; // last 90 days, for charts
  overallConfidence: ForecastConfidence;
  generatedAt: string;
}

const HISTORY_DAYS = 90;
const WINDOW_DAYS = 7;
const FORECAST_DAYS = 7;

/**
 * Pure math: moving-average forecast + variance-based confidence.
 * Unit-testable without a database.
 */
export function forecastFromHistory(
  history: DailyVolume[], // ascending by date, may have gaps
): { predictedVolume: number; confidence: ForecastConfidence; basis: DailyVolume[] } {
  const basis = history.slice(-WINDOW_DAYS);
  if (basis.length === 0) {
    return { predictedVolume: 0, confidence: "low", basis: [] };
  }
  const values = basis.map((d) => d.volume);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / values.length;
  const stddev = Math.sqrt(variance);
  // Coefficient of variation: stable history -> high confidence.
  const cv = mean > 0 ? stddev / mean : 1;
  const confidence: ForecastConfidence =
    basis.length < 4 ? "low" : cv <= 0.35 ? "high" : cv <= 0.7 ? "medium" : "low";
  return {
    predictedVolume: Math.max(0, Math.round(mean)),
    confidence,
    basis,
  };
}

/** Load 90 days of daily ticket volume for a department (null = all). */
export async function loadHistory(
  departmentId: number | null,
): Promise<DailyVolume[]> {
  const { rows } = await pool.query(
    `SELECT to_char(created_at, 'YYYY-MM-DD') AS date, COUNT(*)::int AS volume
     FROM tickets
     WHERE created_at >= now() - make_interval(days => $1)
       AND ($2::int IS NULL OR department_id = $2)
     GROUP BY 1 ORDER BY 1 ASC`,
    [HISTORY_DAYS, departmentId],
  );
  return rows as DailyVolume[];
}

/**
 * Compute the 7-day forecast for a department and persist it.
 * departmentId null = whole workspace.
 */
export async function forecastWorkload(
  departmentId: number | null,
): Promise<DepartmentForecast> {
  const tenantId = await resolveTenantId();
  const history = await loadHistory(departmentId);
  const { predictedVolume, confidence, basis } = forecastFromHistory(history);

  let departmentName = "All departments";
  if (departmentId != null) {
    const { rows } = await pool.query(
      `SELECT name FROM departments WHERE id = $1 LIMIT 1`,
      [departmentId],
    );
    if (!rows[0]) throw new Error(`Department ${departmentId} not found`);
    departmentName = rows[0].name as string;
  }

  const generatedAt = new Date().toISOString();
  const forecast: DayForecast[] = [];
  for (let i = 1; i <= FORECAST_DAYS; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const date = d.toISOString().slice(0, 10);
    forecast.push({ date, predictedVolume, confidence, basis });
    await pool.query(
      `INSERT INTO workload_predictions
         (tenant_id, department_id, forecast_date, predicted_volume, confidence, basis)
       VALUES ($1,$2,$3::date,$4,$5,$6::jsonb)
       ON CONFLICT (tenant_id, department_id, forecast_date) DO UPDATE SET
         predicted_volume = EXCLUDED.predicted_volume,
         confidence = EXCLUDED.confidence,
         basis = EXCLUDED.basis,
         created_at = now()`,
      [
        tenantId, departmentId, date, predictedVolume, confidence,
        JSON.stringify({ history_window_days: WINDOW_DAYS, basis }),
      ],
    );
  }

  return {
    departmentId, departmentName, forecast, history,
    overallConfidence: confidence, generatedAt,
  };
}

/** Today's stored forecast across departments (for the command center). */
export async function todaysForecast(): Promise<
  { departmentId: number | null; departmentName: string; predictedVolume: number; confidence: ForecastConfidence }[]
> {
  const tenantId = await resolveTenantId();
  const { rows } = await pool.query(
    `SELECT wp.department_id AS "departmentId",
            COALESCE(d.name, 'All departments') AS "departmentName",
            wp.predicted_volume AS "predictedVolume",
            wp.confidence
     FROM workload_predictions wp
     LEFT JOIN departments d ON d.id = wp.department_id
     WHERE wp.tenant_id = $1 AND wp.forecast_date = CURRENT_DATE
     ORDER BY wp.predicted_volume DESC`,
    [tenantId],
  );
  return rows as {
    departmentId: number | null; departmentName: string;
    predictedVolume: number; confidence: ForecastConfidence;
  }[];
}
