import { existsSync, readFileSync } from "node:fs";
import { COMMON_RULES, CHIEF_DELEGATION, EXECUTOR_CHECKLIST, VERIFICATION_CHECKLIST } from "./rules.ts";
import { CHIEF_ALLOWED_TOOLS, countCommentLines, BANNED_TEST_MARKERS, editInputPaths, editAddedText, isCodeFile } from "./tool-guards.ts";

export default function (pi) {
	let memorySearchCalled = false;
	const taskStack = [];

	pi.setLabel?.("Governance");

	pi.on("session_start", async (_event, _ctx) => {
		memorySearchCalled = false;
		taskStack.length = 0;
	});

	pi.on("before_agent_start", async (event, ctx) => {
		const blocks = [COMMON_RULES];
		if (ctx.hasUI) {
			blocks.push(CHIEF_DELEGATION);
		} else {
			blocks.push(EXECUTOR_CHECKLIST);
		}
		return { systemPrompt: [...event.systemPrompt, ...blocks] };
	});

	pi.on("tool_call", async (event, ctx) => {
		const tool = event.toolName;
		const args = event.input ?? {};

		if (tool === "memorysearch") memorySearchCalled = true;

		if (ctx.hasUI && !CHIEF_ALLOWED_TOOLS.has(tool)) {
			return { block: true, reason: `BLOCKED: the chief is dispatch-only. '${tool}' must run inside a subagent — dispatch it via the 'task' tool (one unit of work per dispatch: reading, writing, running commands, and testing each get their own agent). Allowed chief tools: ${[...CHIEF_ALLOWED_TOOLS].join(", ")}.` };
		}

		if (tool === "task") {
			if (ctx.hasUI && taskStack.length === 0 && !memorySearchCalled) {
				return { block: true, reason: "BLOCKED: rule #8 — call 'memorysearch' before dispatching any agent. Search for relevant past sessions first, then proceed." };
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

	pi.on("tool_result", async (event) => {
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
