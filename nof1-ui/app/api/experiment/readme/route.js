import { getExperimentReadme } from "../../../../lib/dataRepository";

export async function GET() {
  const readme = await getExperimentReadme();
  if (!readme) {
    return Response.json({ message: "experiment readme not found" }, { status: 404 });
  }
  return Response.json(readme);
}
