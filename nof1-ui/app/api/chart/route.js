import { chartSeries, chartPoints } from "../../../lib/mockData";

export async function GET() {
  return Response.json({ series: chartSeries, points: chartPoints });
}

