import { pendingDecisions } from "../../../../lib/mockData";

export async function GET() {
  return Response.json({ decisions: pendingDecisions });
}

