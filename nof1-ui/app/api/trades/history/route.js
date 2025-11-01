import { tradesHistory } from "../../../../lib/mockData";

export async function GET() {
  return Response.json(tradesHistory);
}

