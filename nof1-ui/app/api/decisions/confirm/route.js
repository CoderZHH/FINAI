import { confirmDecision } from "../../../../lib/dataRepository";

export async function POST(request) {
  const payload = await request.json();
  const decision = await confirmDecision(payload);
  return Response.json({ ok: Boolean(decision), decision });
}
