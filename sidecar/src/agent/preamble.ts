// The block the sidecar puts in front of every prompt: where the agent is
// and what is on the bench right now. Short on purpose (under ~250 words
// with two units and a few problems); the guide is AGENTS.md.
import { join } from "node:path";
import { unitType } from "../units/index.ts";
import type { AgentHost } from "./types.ts";

const hex = (address: number) => `0x${address.toString(16).toUpperCase().padStart(2, "0")}`;
const clip = (text: string, limit: number) => text.length > limit ? `${text.slice(0, limit - 1)}…` : text;

export function composePreamble(bench: AgentHost["bench"], workspace: string, context?: string): string {
  const project = bench.project;
  if (!project) return "";
  const lines = [`Project "${project.title}" in ${project.path} (your working directory). It runs on the simulated M5Stack Tab5 of Pocket Bench and is rebuilt when a file changes.`];
  if (bench.units.length) {
    const units = bench.units.map(unit => {
      const type = unitType(unit.type);
      return type ? `${type.name} (${unit.uid}, type ${type.id}, I2C ${type.addresses.map(hex).join(" ")})` : `${unit.type} (${unit.uid})`;
    });
    lines.push(`Units plugged into Port A: ${units.join("; ")}.`);
  } else lines.push("No Unit is plugged into Port A.");
  if (context?.trim()) lines.push(context.trim());
  if (bench.problems.length) {
    const shown = bench.problems.slice(0, 5).map(problem => `  ${problem.file ? `${problem.file}:${problem.line ?? 0} ` : ""}${clip(problem.message, 200)}`);
    lines.push(`The last build failed:\n${shown.join("\n")}${bench.problems.length > 5 ? `\n  and ${bench.problems.length - 5} more (bench check)` : ""}`);
  }
  if (bench.failure) lines.push(`The app stopped with a fault in ${bench.failure.domain}: ${clip(bench.failure.message, 300)}`);
  lines.push(`On your first turn read ${join(workspace, "AGENTS.md")}. Finish every change by running \`bench check\` and fix what it reports.`);
  return `<bench>\n${lines.join("\n")}\n</bench>\n\n`;
}
