import { modeState } from "../../../lib/mockData";

export async function GET() {
  return Response.json(modeState);
}
