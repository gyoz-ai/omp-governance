import factory, { typesenseFetch, PLAN_COLLECTION, PLAN_SCHEMA, sanitizeProject } from "./plan-tool.ts";

const pi = { hasUI: true, cwd: process.cwd(), zod: { object: (s) => ({ shape: s }), enum: (v) => ({ _enum: v, optional() { return this; } }), string: () => ({ optional() { return this; } }) } };
const sessionId = `live-${Date.now()}`;
const ctx = { sessionManager: { getSessionId: () => sessionId } };

const collections = await typesenseFetch("/collections", "GET");
if (!Array.isArray(collections)) {
	console.error("Typesense unreachable. Start the container, then re-run.");
	process.exit(1);
}
if (!new Set(collections.map((c) => c.name)).has(PLAN_COLLECTION)) await typesenseFetch("/collections", "POST", PLAN_SCHEMA);

const tool = factory(pi);
console.log("project:", sanitizeProject(pi.cwd), "session:", sessionId);
console.log("draft   ->", (await tool.execute("1", { op: "draft", body: "live round-trip plan body" }, undefined, ctx)).content[0].text);
console.log("show    ->", (await tool.execute("2", { op: "show" }, undefined, ctx)).content[0].text);
console.log("finalize->", (await tool.execute("3", { op: "finalize" }, undefined, ctx)).content[0].text);
console.log("show    ->", (await tool.execute("4", { op: "show" }, undefined, ctx)).content[0].text);

await typesenseFetch(`/collections/${PLAN_COLLECTION}/documents/${encodeURIComponent(sessionId)}`, "DELETE");
console.log("cleanup -> deleted", sessionId);
