import { saveProposalRequest } from "../../../../lib/dataRepository";

export async function POST(request) {
  const payload = await request.json();
  const result = await saveProposalRequest(payload);
  return Response.json({ ok: true, ...result });
}
