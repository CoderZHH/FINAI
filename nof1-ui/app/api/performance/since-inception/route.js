import { sinceInception } from "../../../../lib/mockData";

export async function GET() {
  return Response.json(sinceInception);
}

