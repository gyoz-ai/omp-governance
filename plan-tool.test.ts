import { test, expect, beforeEach, afterEach } from "bun:test";
import factory, { sanitizeProject } from "./plan-tool.ts";
import { sessionPhase } from "./tool-guards.ts";

const zStub = {
	object: (shape) => ({ shape }),
	enum: (vals) => ({ _enum: vals, optional() { return this; } }),
	string: () => ({ optional() { return this; } }),
};

const chiefPi = { hasUI: true, cwd: "/home/u/Projects/MyProj", zod: zStub };
const ctx = { sessionManager: { getSessionId: () => "sess-plan" } };

const realFetch = globalThis.fetch;
let calls;

function jsonRes(data, status = 200) {
	return { ok: status < 400, status, json: async () => data };
}

beforeEach(() => {
	calls = [];
	sessionPhase.clear();
});

afterEach(() => {
	globalThis.fetch = realFetch;
});

test("plan tool is hidden from subagents (no UI)", () => {
	const t = factory({ hasUI: false, cwd: "/x", zod: zStub });
	expect(Array.isArray(t)).toBe(true);
	expect(t.length).toBe(0);
});

test("plan tool is exposed to the chief (UI)", () => {
	const t = factory(chiefPi);
	expect(t.name).toBe("plan");
	expect(t.approval).toBe("read");
});

test("draft upserts a draft doc keyed by session id", async () => {
	globalThis.fetch = async (url, opts) => {
		calls.push({ url, opts });
		return jsonRes({});
	};
	const t = factory(chiefPi);
	const r = await t.execute("id1", { op: "draft", body: "step 1: do the thing" }, undefined, ctx);
	expect(r.details.status).toBe("draft");
	const upsert = calls.find((c) => c.url.includes("action=upsert"));
	expect(upsert).toBeDefined();
	const doc = JSON.parse(upsert.opts.body);
	expect(doc.id).toBe("sess-plan");
	expect(doc.session_id).toBe("sess-plan");
	expect(doc.status).toBe("draft");
	expect(doc.body).toBe("step 1: do the thing");
	expect(doc.project).toBe(sanitizeProject("/home/u/Projects/MyProj"));
	expect(typeof doc.updated_at).toBe("number");
});

test("draft without body returns an instructive error and does not flip phase", async () => {
	globalThis.fetch = async () => jsonRes({});
	const t = factory(chiefPi);
	const r = await t.execute("id1", { op: "draft" }, undefined, ctx);
	expect(r.content[0].text).toContain("ERROR");
	expect(sessionPhase.has("sess-plan")).toBe(false);
});

test("finalize flips status to final and phase to executing", async () => {
	globalThis.fetch = async (url, opts) => {
		calls.push({ url, opts });
		if (opts?.method === "GET") return jsonRes({ id: "sess-plan", status: "draft", body: "the drafted plan" });
		return jsonRes({});
	};
	const t = factory(chiefPi);
	const r = await t.execute("id1", { op: "finalize" }, undefined, ctx);
	expect(r.details.status).toBe("final");
	expect(sessionPhase.get("sess-plan")).toBe("executing");
	const upsert = calls.find((c) => c.url.includes("action=upsert"));
	const doc = JSON.parse(upsert.opts.body);
	expect(doc.status).toBe("final");
	expect(doc.body).toBe("the drafted plan");
});

test("finalize with no existing plan and no body errors and does not flip phase", async () => {
	globalThis.fetch = async (url, opts) => {
		if (opts?.method === "GET") return jsonRes({ message: "Not Found" }, 404);
		return jsonRes({});
	};
	const t = factory(chiefPi);
	const r = await t.execute("id1", { op: "finalize" }, undefined, ctx);
	expect(r.content[0].text).toContain("ERROR");
	expect(sessionPhase.has("sess-plan")).toBe(false);
});

test("show returns the current plan", async () => {
	globalThis.fetch = async () => jsonRes({ id: "sess-plan", status: "final", body: "the final plan" });
	const t = factory(chiefPi);
	const r = await t.execute("id1", { op: "show" }, undefined, ctx);
	expect(r.content[0].text).toContain("the final plan");
	expect(r.details.status).toBe("final");
});

test("failure mode: fetch throws -> loud error with isError", async () => {
	globalThis.fetch = async () => {
		throw new Error("ECONNREFUSED 127.0.0.1:8108");
	};
	const t = factory(chiefPi);
	const r = await t.execute("id1", { op: "draft", body: "x" }, undefined, ctx);
	expect(r.isError).toBe(true);
	expect(r.content[0].text).toContain("unreachable");
});

test("failure mode: non-ok status -> loud error with isError", async () => {
	globalThis.fetch = async () => jsonRes({ message: "unauthorized" }, 401);
	const t = factory(chiefPi);
	const r = await t.execute("id1", { op: "show" }, undefined, ctx);
	expect(r.isError).toBe(true);
	expect(r.content[0].text).toContain("failed");
});
