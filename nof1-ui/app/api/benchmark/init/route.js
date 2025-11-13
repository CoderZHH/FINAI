import { initializeBtcBenchmark } from "../../../../lib/dataRepository.js";

/**
 * 初始化 BTC 基准线
 * POST /api/benchmark/init
 */
export async function POST() {
  try {
    const result = await initializeBtcBenchmark();
    return Response.json(result);
  } catch (error) {
    console.error('BTC benchmark init error:', error);
    return Response.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
