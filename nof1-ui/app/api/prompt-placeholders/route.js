import { listPromptPlaceholders } from "../../../lib/dataRepository";

export async function GET() {
  const placeholders = await listPromptPlaceholders();
  return Response.json({ placeholders });
}
