import { tradesRecent } from "../../../../lib/mockData";

export async function GET() {
  return Response.json(tradesRecent);
}

