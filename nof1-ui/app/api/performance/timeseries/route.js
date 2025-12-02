import { getPerformanceTimeseries } from "../../../../lib/data/dataRepository";
import { ensureAutoRunner } from "../../../../lib/trading/autoRunner";

export async function GET() {
  ensureAutoRunner();
  const seriesData = await getPerformanceTimeseries();
  return Response.json({ ...seriesData, serverTime: Date.now() });
}
