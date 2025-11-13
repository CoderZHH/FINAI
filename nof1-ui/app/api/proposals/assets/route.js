import { getProposalAssets } from "../../../../lib/dataRepository";

export async function GET() {
  try {
    const assets = await getProposalAssets();
    return Response.json({ assets });
  } catch (error) {
    console.error('[API /proposals/assets] Error:', error);
    return Response.json(
      { error: error.message, stack: error.stack },
      { status: 500 }
    );
  }
}
