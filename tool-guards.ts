import { isCodeFile } from "./lib/code-files.ts";

export const CHIEF_ALLOWED_TOOLS = new Set(["task", "todo", "ask", "irc", "job", "hub", "resolve", "memorysearch", "search_tool_bm25", "read", "plan"]);

export const sessionPhase = new Map();

export const COMMENT_LINE_GLOBAL = /^[\t ]*(?:\/\/|\/\*|\*[^/]|\/{3}|#(?![!\w$\[])|--(?![\w$]))/gm;

export function countCommentLines(s) {
	if (!s) return 0;
	const m = s.match(COMMENT_LINE_GLOBAL);
	return m ? m.length : 0;
}

export const BANNED_TEST_MARKERS = /\/\/\s*(?:TODO|FIXME|for now|will do later|skip)\b|\b(?:tbd|TBD)\b/i;

export function editInputPaths(input) {
	const paths = [];
	const re = /\[([^\]#]+)#[0-9A-Fa-f]{4}\]/g;
	let m;
	while ((m = re.exec(input)) !== null) paths.push(m[1]);
	return paths;
}

export function editAddedText(input) {
	const added = [];
	for (const line of String(input).split("\n")) {
		if (line.startsWith("+") && !line.startsWith("+++")) added.push(line.slice(1));
	}
	return added.join("\n");
}

export { isCodeFile };
