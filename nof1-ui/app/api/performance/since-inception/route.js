import { getSinceInceptionValues } from "../../../../lib/data/dataRepository";

export async function GET() {
  const sinceInceptionValues = await getSinceInceptionValues();
  return Response.json({ sinceInceptionValues, serverTime: Date.now() });
}
