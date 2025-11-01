import { getAgentAccounts } from "../../../lib/dataRepository";

export async function GET() {
  const accounts = await getAgentAccounts();
  const models = accounts.map((account) => ({
    model_id: account.model_id,
    display_name: account.name,
    description: "Demo model entry. Replace with real strategy description and risk tags.",
    capabilities: ["Trend following", "Risk coordination", "Position management"],
  }));
  return Response.json({ models });
}
