import { leaderboard } from "../../../lib/mockData";

export async function GET() {
  return Response.json({ rows: leaderboard });
}

