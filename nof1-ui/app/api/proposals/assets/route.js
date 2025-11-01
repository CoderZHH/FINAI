import { getProposalAssets } from "../../../../lib/dataRepository";

export async function GET() {
  const assets = await getProposalAssets();
  return Response.json({ assets });
}
