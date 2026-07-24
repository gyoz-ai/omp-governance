import { existsSync, readFileSync } from "node:fs";
import { COMMON_RULES, ADHD_OUTPUT_STYLE, STE_TECHNICAL_ENGLISH, CHIEF_DELEGATION, EXECUTOR_CHECKLIST, VERIFICATION_CHECKLIST } from "./rules.ts";
import { CHIEF_ALLOWED_TOOLS, sessionPhase, countCommentLines, BANNED_TEST_MARKERS, editInputPaths, editAddedText, isCodeFile } from "./tool-guards.ts";
import { typesenseFetch, sanitizeProject, PLAN_COLLECTION, PLAN_SCHEMA } from "./plan-tool.ts";

export default function (pi) {
	let memorySearchCalled = false;
	const taskStack = [];
	let project = "unknown";
	let planFirstDisabled = false;

	pi.setLabel?.("Governance");

	pi.on("session_start", async (_event, ctx) => {
		memorySearchCalled = false;
		taskStack.length = 0;
		project = sanitizeProject(ctx.cwd || process.cwd());
		planFirstDisabled = false;
		if (!ctx.hasUI) return;
		const sessionId = ctx.sessionManager?.getSessionId?.();
		try {
			const existing = await typesenseFetch("/collections", "GET");
			if (!Array.isArray(existing)) throw new Error("unexpected /collections response");
			const names = new Set(existing.map((c) => c.name));
			if (!names.has(PLAN_COLLECTION)) await typesenseFetch("/collections", "POST", PLAN_SCHEMA);
			if (sessionId) sessionPhase.set(sessionId, "planning");
		} catch {
			planFirstDisabled = true;
		}
	});

	pi.on("before_agent_start", async (event, ctx) => {
		const blocks = [COMMON_RULES, ADHD_OUTPUT_STYLE, STE_TECHNICAL_ENGLISH];
		if (ctx.hasUI) {
			blocks.push(CHIEF_DELEGATION);
			if (planFirstDisabled) blocks.push("<plan_first_status>\nWARNING: the plan store (Typesense) is unreachable. Plan-first enforcement is DISABLED for this session. You may dispatch executor agents directly. Start the plan-store container to restore plan-first gating.\n</plan_first_status>");
		} else {
			blocks.push(EXECUTOR_CHECKLIST);
			try {
				const res = await typesenseFetch(`/collections/${PLAN_COLLECTION}/documents/search?q=*&query_by=body&filter_by=project:=${project} && status:=final&sort_by=updated_at:desc&per_page=1&exclude_fields=embedding`, "GET");
				const doc = res?.hits?.[0]?.document;
				if (doc?.body) blocks.push(`<execution_plan>\nThe chief finalized this execution plan for the current work. Follow it for your slice.\n\n${doc.body}\n</execution_plan>`);
			} catch {}
		}
		return { systemPrompt: [...event.systemPrompt, ...blocks] };
	});

	pi.on("tool_call", async (event, ctx) => {
		const tool = event.toolName;
		const args = event.input ?? {};

		const xdTool = tool === "write" && String(args.path ?? "").startsWith("xd://") ? String(args.path).slice(5).split(/[/?#]/)[0] : "";
		if (tool === "memorysearch" || xdTool === "memorysearch") memorySearchCalled = true;

		if (ctx.hasUI && !CHIEF_ALLOWED_TOOLS.has(tool) && !CHIEF_ALLOWED_TOOLS.has(xdTool)) {
			return { block: true, reason: `BLOCKED: the chief is dispatch-only. '${tool}' must run inside a subagent — dispatch it via the 'task' tool (one unit of work per dispatch: reading, writing, running commands, and testing each get their own agent). Allowed chief tools: ${[...CHIEF_ALLOWED_TOOLS].join(", ")}.` };
		}

		if (tool === "task") {
			if (ctx.hasUI && taskStack.length === 0 && !memorySearchCalled) {
				return { block: true, reason: "BLOCKED: rule #8 — call 'memorysearch' before dispatching any agent. Search for relevant past sessions first, then proceed." };
			}
			if (ctx.hasUI && sessionPhase.get(ctx.sessionManager?.getSessionId?.()) === "planning") {
				const agents = Array.isArray(args.tasks) ? args.tasks.map((t) => String(t?.agent ?? "")) : [String(args.agent ?? "")];
				if (agents.some((a) => a !== "scout" && a !== "librarian")) {
					return { block: true, reason: "BLOCKED: plan-first — this session is in the PLANNING phase. Dispatch only 'scout' or 'librarian' agents to gather data. Keep gathering data, then draft and finalize the execution plan with the 'plan' tool ('plan' op 'draft', then op 'finalize'). Finalizing the plan unlocks executor dispatch." };
				}
			}
			taskStack.push({ toolCallId: event.toolCallId });
			return;
		}

		if (tool === "write") {
			const filePath = String(args.path ?? "");
			if (filePath.endsWith("Cargo.lock")) return { block: true, reason: "BLOCKED: do not edit Cargo.lock directly. Use 'cargo update' / 'cargo add <crate>' or edit Cargo.toml and run 'cargo check'." };
			const content = String(args.content ?? "");
			let existing = "";
			try {
				if (existsSync(filePath)) existing = readFileSync(filePath, "utf8");
			} catch {}
			if (isCodeFile(filePath)) {
				const existingLines = new Set(existing.split("\n"));
				const newComments = content.split("\n").filter((l) => countCommentLines(l) > 0 && !existingLines.has(l)).length;
				if (newComments > 0) return { block: true, reason: `BLOCKED: rule #2 — this write adds ${newComments} new comment line(s) to ${filePath}. Remove the comment lines from 'content' and retry.` };
			}
			if (/(?:^|\/)(?:tests?|__tests__)\//.test(filePath) || /\.test\.|\.spec\./.test(filePath)) {
				if (BANNED_TEST_MARKERS.test(content) && !BANNED_TEST_MARKERS.test(existing)) return { block: true, reason: "BLOCKED: rule #4 — this test write introduces a banned skip-marker (TODO/FIXME/for now/will do later/skip/tbd). Implement fully or escalate." };
			}
			return;
		}

		if (tool === "edit") {
			const input = String(args.input ?? "");
			const paths = editInputPaths(input);
			for (const p of paths) {
				if (p.endsWith("Cargo.lock")) return { block: true, reason: "BLOCKED: do not edit Cargo.lock directly. Use 'cargo update' / 'cargo add <crate>' or edit Cargo.toml and run 'cargo check'." };
			}
			const added = editAddedText(input);
			if (paths.some(isCodeFile) && countCommentLines(added) > 0) {
				return { block: true, reason: `BLOCKED: rule #2 — this edit adds ${countCommentLines(added)} new comment line(s). Remove comment lines from the '+' body rows and retry.` };
			}
			if (paths.some((p) => /(?:^|\/)(?:tests?|__tests__)\//.test(p) || /\.test\.|\.spec\./.test(p)) && BANNED_TEST_MARKERS.test(added)) {
				return { block: true, reason: "BLOCKED: rule #4 — this test edit introduces a banned skip-marker (TODO/FIXME/for now/will do later/skip/tbd). Implement fully or escalate." };
			}
			return;
		}
	});

	pi.on("tool_result", async (event, ctx) => {
		if (event.toolName === "write") {
			let t = "";
			for (const c of event.content ?? []) {
				if (c?.type === "text") t += c.text;
			}
			if (t.includes("Plan finalized (status=final)")) {
				const sid = ctx?.sessionManager?.getSessionId?.();
				if (sid) sessionPhase.set(sid, "executing");
			}
			return;
		}
		if (event.toolName !== "task") return;
		const idx = taskStack.findIndex((f) => f.toolCallId === event.toolCallId);
		if (idx === -1) return;
		taskStack.splice(idx, 1);

		let text = "";
		for (const c of event.content ?? []) {
			if (c?.type === "text") text += c.text;
		}

		text += VERIFICATION_CHECKLIST;

		return { content: [{ type: "text", text }] };
	});
}
