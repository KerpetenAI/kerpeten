import { describe, expect, test } from "bun:test";
import { findComments, isChecked } from "../../scripts/comments/comments-utils.ts";

const SL = "/";
const LINE = `${SL}${SL}`;
const OPEN = `${SL}*`;
const CLOSE = `*${SL}`;
const DOC = `${SL}**`;
const BT = String.fromCharCode(96);
const HOLE = ["$", "{"].join("");

const at = (text: string) => findComments(text).map((c) => `${c.line}:${c.column}`);

describe("no-comments scanner", () => {
  test("finds line and block comments", () => {
    expect(at(`const a = 1; ${LINE} note\n${OPEN} block ${CLOSE}\nconst b = 2;`)).toEqual(["1:14", "2:1"]);
  });

  test("allows a JSDoc block that starts its line, but not an inline one or an empty block", () => {
    expect(at(`${DOC}\n * doc\n ${CLOSE}\nexport const a = 1;`)).toEqual([]);
    expect(at(`  ${DOC} doc ${CLOSE}\nconst a = 1;`)).toEqual([]);
    expect(at(`const a = 1; ${DOC} doc ${CLOSE}`)).toEqual(["1:14"]);
    expect(at(`${OPEN}${CLOSE}\nconst a = 1;`)).toEqual(["1:1"]);
    expect(at(`${SL}***${SL}\n`)).toEqual([]);
  });

  test("ignores comment markers inside strings and templates", () => {
    expect(at(`const u = "https:${LINE}x"; const v = 'a ${OPEN} b';`)).toEqual([]);
    expect(at(`const t = ${BT}a ${LINE} ${HOLE}x + ${BT}${OPEN}${BT}} b${BT};`)).toEqual([]);
    expect(at(`const t = ${BT}${HOLE}{ a: 1 }.a}${BT} + 1; ${LINE} c`)).toEqual(["1:32"]);
  });

  test("ignores comment markers inside regex literals and still sees comments after division", () => {
    expect(at(`const r = ${SL}[${SL}]${LINE}g;`)).toEqual([]);
    expect(at(`const r = ${SL}a\\${SL}b${SL}.test(x);`)).toEqual([]);
    expect(at(`if (ok) return ${SL}[${LINE}${OPEN}]${SL}.test(s);`)).toEqual([]);
    expect(at(`const h = a ${SL} b; ${LINE} c`)).toEqual(["1:18"]);
    expect(at(`const h = (a) ${SL} 2 ${SL} c; ${LINE} d`)).toEqual(["1:24"]);
  });

  test("sees a comment after division that follows a postfix operator", () => {
    expect(at(`i++ ${SL} 2; ${LINE} c`)).toEqual(["1:10"]);
    expect(at(`i-- ${SL} 2; ${LINE} c`)).toEqual(["1:10"]);
    expect(at(`x! ${SL} y; ${LINE} c`)).toEqual(["1:9"]);
    expect(at(`a[0]++ ${SL} 2; ${LINE} c`)).toEqual(["1:13"]);
    expect(at(`f()! ${SL} 2; ${LINE} c`)).toEqual(["1:11"]);
  });

  test("sees a comment after division by a property named like a keyword", () => {
    expect(at(`obj.default ${SL} 2; ${LINE} note`)).toEqual(["1:18"]);
    expect(at(`x.in ${SL} 2; ${LINE} note`)).toEqual(["1:11"]);
    expect(at(`x?.return ${SL} 2; ${LINE} note`)).toEqual(["1:16"]);
    expect(at(`x\n  .typeof ${SL} 2; ${LINE} note`)).toEqual(["2:16"]);
    expect(at(`const r = [...await ${SL}[${LINE}]${SL}.exec(s)];`)).toEqual([]);
  });

  test("still reads a regex after a prefix operator or a comparison", () => {
    expect(at(`const r = !${SL}[${LINE}]${SL}.test(s);`)).toEqual([]);
    expect(at(`const r = a !== ${SL}[${LINE}]${SL};`)).toEqual([]);
    expect(at(`const r = a != ${SL}[${LINE}]${SL};`)).toEqual([]);
    expect(at(`x = ++${SL}[${LINE}]${SL}.lastIndex;`)).toEqual([]);
    expect(at(`a+++${SL}[${LINE}]${SL}.lastIndex;`)).toEqual([]);
  });

  test("reads a regex that starts the statement after a condition, and still sees division after other parentheses", () => {
    expect(at(`if (ok) ${SL}[${LINE}]${SL}.test(s);`)).toEqual([]);
    expect(at(`if (f(a)) ${SL}[${LINE}]${SL}.test(s);`)).toEqual([]);
    expect(at(`while (more) ${SL}[${LINE}]${SL}.exec(s);`)).toEqual([]);
    expect(at(`for (const s of all) ${SL}[${LINE}]${SL}.test(s);`)).toEqual([]);
    expect(at(`if (a) x = (b) ${SL} 2; ${LINE} c`)).toEqual(["1:21"]);
    expect(at(`x.if(a) ${SL} 2; ${LINE} c`)).toEqual(["1:14"]);
  });

  test("reads a regex after a condition that has a comment between its keyword and its parenthesis", () => {
    expect(at(`if\n${DOC} doc ${CLOSE}\n(ok) ${SL}[${LINE}]${SL}.test(s);`)).toEqual([]);
    expect(at(`while ${OPEN} c ${CLOSE} (more) ${SL}[${LINE}]${SL}.exec(s);`)).toEqual(["1:7"]);
    expect(at(`if ${LINE} c\n(ok) ${SL}[${LINE}]${SL}.test(s);`)).toEqual(["1:4"]);
  });

  test("skips a shebang and reports a comment after it", () => {
    expect(at(`#!/usr/bin/env bun\n${LINE} x\n`)).toEqual(["2:1"]);
  });

  test("reports an unterminated block comment", () => {
    expect(at(`const a = 1;\n${OPEN} open`)).toEqual(["2:1"]);
  });

  test("checks hand-written .ts and .mjs only", () => {
    expect(isChecked("src/a.ts")).toBe(true);
    expect(isChecked("scripts/x.mjs")).toBe(true);
    expect(isChecked("src/types/api.generated.ts")).toBe(false);
    expect(isChecked("src/a.json")).toBe(false);
    expect(isChecked("src/a.js")).toBe(false);
  });
});
