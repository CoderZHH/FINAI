import { getPerformanceTimeseries } from "../../../../lib/dataRepository";

export async function GET() {
  const seriesData = await getPerformanceTimeseries();
  return Response.json({ ...seriesData, serverTime: Date.now() });
}
