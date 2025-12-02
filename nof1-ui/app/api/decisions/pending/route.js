import { getPendingDecisions } from "../../../../lib/data/dataRepository";

export async function GET() {
  const decisions = await getPendingDecisions();
  return Response.json({ decisions });
}
