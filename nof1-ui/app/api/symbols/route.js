"use server";

import { NextResponse } from "next/server";
import { loadAllModelAllowedSymbols, getTrackedSymbols } from "../../../lib/dataRepository.js";

export async function GET() {
  await loadAllModelAllowedSymbols();
  const symbols = getTrackedSymbols();
  return NextResponse.json({ symbols });
}
