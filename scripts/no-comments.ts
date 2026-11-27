import { runNoComments } from "./comments/comments-utils.ts";

if (import.meta.main) process.exit(runNoComments(process.cwd()));
