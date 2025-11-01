import { getAgentLogs } from "../../../../lib/dataRepository";

export async function GET(request) {
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") || 20);
  const logs = await getAgentLogs(limit);
  return Response.json({ logs });
}
