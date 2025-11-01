export async function POST(request) {
  const payload = await request.json();
  // TODO: 将申请的交易批量写入撮合队列或风控系统
  return Response.json({ ok: true, received: payload });
}
