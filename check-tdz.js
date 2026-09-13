// Catches a `const` read above the line that declares it — inside a function,
// where check-app-boot.js cannot see it.
//
// check-app-boot.js evaluates the file's top level and mounts nothing, so it
// catches the top-level ordering bug and only that one. The same mistake one
// scope in is just as fatal and shows the same way: `expressionSummary` in
// UserProfileEditor was an IIFE reading `expressions` forty lines above the
// const that declares it, so opening the user profile threw "Cannot access
// 'expressions' before initialization" and took the whole app down with it.
// Nothing caught it, because Babel compiles it happily and the top level never
// runs that function.
//
// A reference inside a nested function is fine — it runs later, by which time
// the declaration has been reached. What is NOT fine is a reference that
// executes as the enclosing function runs: directly in its body, or inside a
// function that is called on the spot (an IIFE). Those are what this reports.
const fs = require("fs");
const path = require("path");

let babel;
try {
  babel = require("@babel/core");
  require.resolve("@babel/preset-react");
} catch {
  console.log("tdz check: skipped — run `npm i @babel/core @babel/preset-react` to enable");
  process.exit(0);
}
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;

const here = (f) => path.join(__dirname, f);
const src = fs.readFileSync(here("index.html"), "utf8");
const m = src.match(/<script[^>]*id="app-source"[^>]*>([\s\S]*?)<\/script>/);
if (!m) { console.error("tdz check: could not find the #app-source script"); process.exit(1); }

// Line numbers are reported against index.html, not the extracted script, so
// they can be jumped to directly.
const lineOffset = src.slice(0, m.index + m[0].indexOf(m[1])).split("\n").length - 1;

const ast = parser.parse(m[1], { sourceType: "script", plugins: ["jsx"], errorRecovery: true });

// Is this reference reached while the binding's own function body is still
// running? True when no function sits between the two, or when every function
// that does is invoked immediately.
const runsImmediately = (refPath, scopePath) => {
  let p = refPath.parentPath;
  while (p && p !== scopePath) {
    if (p.isFunction()) {
      const call = p.parentPath;
      const isIIFE = call && call.isCallExpression() && call.node.callee === p.node;
      if (!isIIFE) return false;
    }
    p = p.parentPath;
  }
  return true;
};

const problems = [];
traverse(ast, {
  Scopable(scopePath) {
    for (const name of Object.keys(scopePath.scope.bindings)) {
      const binding = scopePath.scope.bindings[name];
      // Only real `const`/`let` declarations. Babel also reports catch
      // clause parameters and function parameters as let-ish bindings, and a
      // `catch (e)` whose body reads e is not a dead-zone read.
      if (!binding.path.isVariableDeclarator()) continue;
      const decl = binding.path.parentPath;
      if (!decl.isVariableDeclaration()) continue;
      if (decl.node.kind !== "const" && decl.node.kind !== "let") continue;
      if (binding.scope.path !== scopePath) continue;
      const declEnd = binding.path.node.end;
      for (const ref of binding.referencePaths) {
        if (ref.node.start >= declEnd) continue;
        if (!runsImmediately(ref, scopePath)) continue;
        problems.push({
          name,
          line: lineOffset + ref.node.loc.start.line,
          declLine: lineOffset + binding.identifier.loc.start.line,
        });
      }
    }
  },
});

// ── Second pass: names nothing declares ──────────────────────────────────────
// `expressionSummary` was declared inside UserProfileEditor and read inside
// AppearanceEditor — a different function — so opening a character's editor
// threw "expressionSummary is not defined" and took the app down, exactly like
// the dead-zone bug above. check-interpolations.js could not catch it: it asks
// whether a name is declared ANYWHERE in the file, and this one was.
//
// Babel collects every reference with no binding in scope. Anything that is a
// real global in Node, or a browser global the app legitimately uses, is
// filtered out; what is left is a name that exists nowhere the code reading it
// can see.
const BROWSER_GLOBALS = new Set([
  "window", "document", "navigator", "location", "history", "localStorage",
  "sessionStorage", "alert", "confirm", "prompt", "getComputedStyle",
  "matchMedia", "requestAnimationFrame", "cancelAnimationFrame", "scrollTo",
  "FileReader", "Image", "Audio", "Blob", "File", "FormData", "Headers",
  "Request", "Response", "CustomEvent", "Event", "HTMLElement", "Node",
  "IntersectionObserver", "ResizeObserver", "MutationObserver", "DOMParser",
  "XMLHttpRequest", "WebSocket", "getSelection", "open", "close", "self",
  "React", "ReactDOM", "Babel", "SiteConfig",
]);
const isKnownGlobal = (name) =>
  BROWSER_GLOBALS.has(name) || Object.prototype.hasOwnProperty.call(globalThis, name);

const undeclared = [];
traverse(ast, {
  Program(programPath) {
    for (const name of Object.keys(programPath.scope.globals)) {
      if (isKnownGlobal(name)) continue;
      const node = programPath.scope.globals[name];
      undeclared.push({ name, line: lineOffset + node.loc.start.line });
    }
  },
});

if (problems.length === 0 && undeclared.length === 0) {
  console.log("tdz check: no const read above its declaration, no undeclared names");
  process.exit(0);
}
if (undeclared.length) {
  console.error("tdz check: UNDECLARED — nothing in scope declares these");
  for (const u of undeclared) {
    console.error(`  index.html:${u.line}: '${u.name}'`);
  }
}
if (problems.length === 0) process.exit(1);
console.error("tdz check: READ BEFORE DECLARATION — these throw the moment the code runs");
for (const p of problems) {
  console.error(`  index.html:${p.line}: '${p.name}' is read here, declared at line ${p.declLine}`);
}
process.exit(1);
