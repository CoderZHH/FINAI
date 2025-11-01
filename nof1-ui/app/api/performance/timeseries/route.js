import { performanceTimeseries } from "../../../../lib/mockData";

export async function GET() {
  return Response.json(performanceTimeseries);
}

