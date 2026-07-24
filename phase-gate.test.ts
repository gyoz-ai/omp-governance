import { test, expect, beforeEach, afterEach } from "bun:test";
import plugin from "./index.ts";
import { sessionPhase } from "./tool-guards.ts";

const realFetch = globalThis.fetch;

function jsonRes(data, status = 200) {
	return { ok: status < 400, status, json: async () => data };
}

function makePlugin() {
	const handlers = {};
	const pi = { setLabel() {}, on(name, fn) { handlers[name] = fn; } };
	plugin(pi);
	return handlers;
}

const chiefCtx = { hasUI: true, cwd: "/home/u/Projects/Proj", sessionManager: { getSessionId: () => "sess-gate" } };

function reachableFetch(url, opts) {
	if (url.endsWith("/collections") && (!opts || opts.method === "GET")) return jsonRes([{ name: "memory" }]);
	return jsonRes({});
}

beforeEach(() => {
	sessionPhase.clear();
});

afterEach(() => {
	globalThis.fetch = realFetch;
});

test("session_start enters planning phase when the plan store is reachable", async () => {
	globalThis.fetch = reachableFetch;
	const h = makePlugin();
	await h.session_start({}, chiefCtx);
	expect(sessionPhase.get("sess-gate")).toBe("planning");
});

test("planning blocks a non-scout task dispatch with an instructive reason", async () => {
	globalThis.fetch = reachableFetch;
	const h = makePlugin();
	await h.session_start({}, chiefCtx);
	await h.tool_call({ toolName: "memorysearch", input: {} }, chiefCtx);
	const scout = await h.tool_call({ toolName: "task", toolCallId: "t1", input: { agent: "scout" } }, chiefCtx);
	expect(scout).toBeUndefined();
	const exec = await h.tool_call({ toolName: "task", toolCallId: "t2", input: { agent: "task" } }, chiefCtx);
	expect(exec?.block).toBe(true);
	expect(exec.reason).toContain("PLANNING");
	expect(exec.reason).toContain("scout");
	expect(exec.reason).toContain("finalize");
});

test("librarian is allowed during planning", async () => {
	globalThis.fetch = reachableFetch;
	const h = makePlugin();
	await h.session_start({}, chiefCtx);
	await h.tool_call({ toolName: "memorysearch", input: {} }, chiefCtx);
	const lib = await h.tool_call({ toolName: "task", toolCallId: "t1", input: { agent: "librarian" } }, chiefCtx);
	expect(lib).toBeUndefined();
});

test("after finalize (executing phase) any task dispatch is allowed", async () => {
	globalThis.fetch = reachableFetch;
	const h = makePlugin();
	await h.session_start({}, chiefCtx);
	await h.tool_call({ toolName: "memorysearch", input: {} }, chiefCtx);
	sessionPhase.set("sess-gate", "executing");
	const exec = await h.tool_call({ toolName: "task", toolCallId: "t9", input: { agent: "task" } }, chiefCtx);
	expect(exec).toBeUndefined();
});

test("fail-open: unreachable store disables planning and warns the chief", async () => {
	globalThis.fetch = async () => {
		throw new Error("ECONNREFUSED");
	};
	const h = makePlugin();
	await h.session_start({}, chiefCtx);
	expect(sessionPhase.has("sess-gate")).toBe(false);
	await h.tool_call({ toolName: "memorysearch", input: {} }, chiefCtx);
	const exec = await h.tool_call({ toolName: "task", toolCallId: "t1", input: { agent: "task" } }, chiefCtx);
	expect(exec).toBeUndefined();
	const res = await h.before_agent_start({ systemPrompt: [] }, chiefCtx);
	const warned = res.systemPrompt.some((b) => b.includes("plan_first_status") && b.includes("DISABLED"));
	expect(warned).toBe(true);
});

test("subagent receives the finalized plan in its system prompt", async () => {
	globalThis.fetch = async (url) => {
		if (url.includes("/documents/search")) return jsonRes({ hits: [{ document: { body: "THE FINAL PLAN BODY", status: "final" } }] });
		return jsonRes([]);
	};
	const h = makePlugin();
	await h.session_start({}, chiefCtx);
	const subCtx = { hasUI: false, cwd: "/home/u/Projects/Proj", sessionManager: { getSessionId: () => "sub-1" } };
	const res = await h.before_agent_start({ systemPrompt: [] }, subCtx);
	const injected = res.systemPrompt.some((b) => b.includes("execution_plan") && b.includes("THE FINAL PLAN BODY"));
	expect(injected).toBe(true);
});
