import { getModeState } from "../../../lib/dataRepository";

export async function GET() {
  const state = await getModeState();
  return Response.json(state);
}
