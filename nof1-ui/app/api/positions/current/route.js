import { positionsCurrent } from "../../../../lib/mockData";

export async function GET() {
  return Response.json(positionsCurrent);
}

