export function isRustFile(path) {
	return path.endsWith(".rs");
}

export function isTsLikeFile(path) {
	return /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(path);
}

export function isCodeFile(path) {
	return isRustFile(path) || isTsLikeFile(path);
}
