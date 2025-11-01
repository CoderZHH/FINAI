import { proposalAssets } from "../../../../lib/mockData";

export async function GET() {
  return Response.json({ assets: proposalAssets });
}

