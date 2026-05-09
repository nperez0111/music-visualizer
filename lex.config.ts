import { defineLexiconConfig } from "@atcute/lex-cli";

export default defineLexiconConfig({
	files: ["lexicons/**/*.json"],
	outdir: "packages/lexicons/src/generated",
	imports: ["@atcute/atproto"],
});
