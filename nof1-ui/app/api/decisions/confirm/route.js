export async function POST(request) {
  const payload = await request.json();
  // TODO: 将确认后的决策写入数据库或事件流
  return Response.json({ ok: true, received: payload });
}
