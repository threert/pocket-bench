// Pocket Bench's sidecar: the simulated Tab5, the project's builds and the
// coding agent, for the app that shows them.
//   bun src/main.ts [--project <name>] [--port N]
import { installAgent, installCli } from "./agent/index.ts";
import { installLessons } from "./lessons/index.ts";
import { Server } from "./server.ts";
import { listProjects } from "./workspace.ts";

const args = process.argv.slice(2);
const option = (name: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const server = new Server();
installAgent(server);
installLessons(server);
const port = server.start(option("--port") ? Number(option("--port")) : undefined);
installCli();
// The app reads this line to find the port.
console.log(JSON.stringify({ t: "listening", port }));
const wanted = option("--project");
if (wanted) {
  const project = listProjects().find(item => item.name === wanted);
  if (project) void server.bench.open(project);
  else console.error(`no project ${wanted}`);
}
process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
// The app holds our stdin and closes it when it quits (--with-parent).
if (args.includes("--with-parent")) {
  process.stdin.on("end", () => process.exit(0));
  process.stdin.on("close", () => process.exit(0));
  process.stdin.resume();
}
