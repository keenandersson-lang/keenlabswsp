import { mockBacktestArtifacts } from "./mockData";
import { BacktestArtifactLoadResult } from "./types";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function loadBacktestArtifacts(search: string): Promise<BacktestArtifactLoadResult> {
  const params = new URLSearchParams(search);

  if (params.get("error") === "1") {
    await delay(100);
    throw new Error("Failed to parse backtest artifact bundle.");
  }

  if (params.get("demo") === "1") {
    await delay(100);
    return { data: mockBacktestArtifacts, mode: "mock" };
  }

  await delay(80);
  return { data: null, mode: "empty" };
}
