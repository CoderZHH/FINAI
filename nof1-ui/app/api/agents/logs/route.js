import { agentsLogs } from "../../../../lib/mockData";

export async function GET() {
  return Response.json(agentsLogs);
}

