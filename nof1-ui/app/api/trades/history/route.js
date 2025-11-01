import { getTradesHistory } from "../../../../lib/dataRepository";

export async function GET(request) {
  const url = new URL(request.url);
  const page = Number(url.searchParams.get("page") || 1);
  const pageSize = Number(url.searchParams.get("pageSize") || url.searchParams.get("page_size") || 50);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  const history = await getTradesHistory({ page, pageSize, from, to });
  return Response.json(history);
}
