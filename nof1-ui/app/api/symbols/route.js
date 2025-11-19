"use server";

import { getTrackedSymbols } from "../../../lib/dataRepository.js";

export async function GET() {
  const symbols = getTrackedSymbols();
  return Response.json({ symbols });
}
