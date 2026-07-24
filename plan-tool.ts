import { sessionPhase } from "./tool-guards.ts";

const TYPESENSE_URL = process.env.TYPESENSE_URL || "http://localhost:8108";
const TYPESENSE_KEY = process.env.TYPESENSE_KEY || "omp-local-key";
export const PLAN_COLLECTION = "plan";

export const PLAN_SCHEMA = {
	name: PLAN_COLLECTION,
	fields: [
		{ name: "project", type: "string", facet: true },
		{ name: "session_id", type: "string" },
		{ name: "status", type: "string", facet: true },
		{ name: "body", type: "string" },
		{ name: "updated_at", type: "int64", range_index: true },
		{ name: "embedding", type: "float[]", embed: { from: ["body"], model_config: { model_name: "ts/all-MiniLM-L12-v2" } } },
	],
};

export async function typesenseFetch(path, method, body) {
	const opts = { method, headers: { "Content-Type": "application/json", "X-TYPESENSE-API-KEY": TYPESENSE_KEY } };
	if (body) opts.body = JSON.stringify(body);
	const res = await fetch(`${TYPESENSE_URL}${path}`, opts);
	if (!res.ok && res.status !== 404 && res.status !== 409) throw new Error(`Typesense responded ${res.status} for ${method} ${path}`);
	return res.json().catch(() => null);
}

export function sanitizeProject(dir) {
	return (dir.split("/").pop() || "unknown").toLowerCase().replace(/[^a-z0-9_-]/g, "_");
}

const factory = (pi) => {
	return {
		name: "plan",
		label: "Plan",
		description: "Plan-first chief tool backed by the Typesense 'plan' store. op 'draft' saves the current execution plan (status=draft); op 'finalize' locks it (status=final), closes the planning phase, and unlocks executor dispatch; op 'show' prints the current plan. Executor subagents receive the finalized plan automatically.",
		parameters: pi.zod.object({
			op: pi.zod.enum(["draft", "finalize", "show"]),
			body: pi.zod.string().optional(),
		}),
		approval: "read",
		async execute(_id, params, _onUpdate, ctx) {
			const project = sanitizeProject(pi.cwd);
			const sessionId = ctx.sessionManager?.getSessionId?.() || "unknown";
			const docPath = `/collections/${PLAN_COLLECTION}/documents/${encodeURIComponent(sessionId)}`;
			try {
				if (params.op === "draft") {
					if (!params.body) return { content: [{ type: "text", text: "ERROR: 'draft' requires a 'body' argument containing the full execution plan." }] };
					const now = Math.floor(Date.now() / 1000);
					await typesenseFetch(`/collections/${PLAN_COLLECTION}/documents?action=upsert`, "POST", { id: sessionId, project, session_id: sessionId, status: "draft", body: params.body, updated_at: now });
					return { content: [{ type: "text", text: "Plan drafted (status=draft). Keep gathering data with scout/librarian agents, then run 'plan' op 'finalize' to lock the plan and unlock executor dispatch." }], details: { status: "draft" } };
				}
				if (params.op === "finalize") {
					const current = await typesenseFetch(docPath, "GET");
					const body = params.body ?? current?.body;
					if (!body) return { content: [{ type: "text", text: "ERROR: no plan to finalize. Run 'plan' op 'draft' with a body first, or pass a body to finalize." }] };
					const now = Math.floor(Date.now() / 1000);
					await typesenseFetch(`/collections/${PLAN_COLLECTION}/documents?action=upsert`, "POST", { id: sessionId, project, session_id: sessionId, status: "final", body, updated_at: now });
					sessionPhase.set(sessionId, "executing");
					return { content: [{ type: "text", text: "Plan finalized (status=final). Planning phase closed — executor dispatch unlocked. Executor subagents receive this plan automatically." }], details: { status: "final" } };
				}
				const current = await typesenseFetch(docPath, "GET");
				if (!current?.body) return { content: [{ type: "text", text: "No plan for this session yet. Run 'plan' op 'draft' to create one." }] };
				return { content: [{ type: "text", text: `Plan (status=${current.status}):\n\n${current.body}` }], details: { status: current.status } };
			} catch (e) {
				return { content: [{ type: "text", text: `ERROR: the plan store (Typesense) request failed: ${e?.message ?? e}. The plan store is unreachable. Check the container: docker ps | grep typesense.` }], isError: true };
			}
		},
	};
};

export default factory;
