import { getPerformanceTimeseries } from "../../../lib/dataRepository";

export async function GET() {
  const { series } = await getPerformanceTimeseries();

  const maxLength = Math.max(...series.map((entry) => entry.points.length));
  const points = [];

  for (let idx = 0; idx < maxLength; idx += 1) {
    const record = { values: {} };
    series.forEach((entry) => {
      const point = entry.points[idx];
      if (point) {
        record.timestamp = record.timestamp ?? point.timestamp;
        record.values[entry.model_id] = point.dollar_equity;
      }
    });
    if (Object.keys(record.values).length) {
      points.push(record);
    }
  }

  return Response.json({ series, points });
}
