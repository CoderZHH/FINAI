import { getPerformanceTimeseries } from "../../../../lib/dataRepository";
import { ensureAutoRunner } from "../../../../lib/autoRunner";

export async function GET() {
  ensureAutoRunner();
  const seriesData = await getPerformanceTimeseries();
  return Response.json({ ...seriesData, serverTime: Date.now() });
}
