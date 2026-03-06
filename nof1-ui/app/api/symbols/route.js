"use server";

import { NextResponse } from "next/server";
import { listAgentModels } from "../../../lib/data/dataRepository.js";
import { requirePrincipal } from "../../../lib/auth/requestAuth.js";

export async function GET(request) {
  const auth = await requirePrincipal(request, { allowGuest: true, requireWrite: false });
  if (!auth.ok) return auth.response;
  const models = await listAgentModels({
    includeDisabled: true,
    includeSecrets: false,
    ownerUserId: auth.principal.userId,
  });
  const symbols = Array.from(
    new Set(
      models
        .flatMap((model) => model.allowed_symbols ?? [])
        .map((symbol) => String(symbol ?? "").toUpperCase().replace(/USDT$/i, ""))
        .filter(Boolean)
    )
  );
  return NextResponse.json({ symbols });
}
