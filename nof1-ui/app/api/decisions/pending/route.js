import { getPendingDecisions } from "../../../../lib/dataRepository";

export async function GET() {
  const decisions = await getPendingDecisions();
  return Response.json({ decisions });
}
