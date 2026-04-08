import type { VercelRequest, VercelResponse } from "@vercel/node";
import { HealthCheckResponse } from "@workspace/api-zod";

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const data = HealthCheckResponse.parse({
    status: "ok"
  });

  return res.status(200).json(data);
}
