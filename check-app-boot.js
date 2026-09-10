// Catches the bug that shipped a black page: a top-level `const` written above
// the line that declares what it reads.
//
// index.html's app source is one long script compiled by Babel at runtime, so
// every top-level const in it is evaluated the moment the file is read — not
// when a component renders. USER_TABS was written as ["You", ...APPEARANCE_TABS]
// several hundred lines above APPEARANCE_TABS, which put the spread in the
// temporal dead zone: a ReferenceError before anything mounted, reported only
// in a console nobody has open on a phone.
//
// Compiling the source does not catch it — Babel transformed it perfectly.
// The only thing that catches it is running the top level, which is what this
// does: enough of React and the DOM to get through module evaluation, and
// nothing beyond it. Nothing is mounted and no component is rendered, so this
// says only that the file can be loaded — which is the one thing it exists to
// say, and the one thing that failed.
const fs = require("fs");
const path = require("path");

let babel;
try {
  babel = require("@babel/core");
  require.resolve("@babel/preset-react");
} catch {
  console.log("app boot: skipped — run `npm i @babel/core @babel/preset-react` to enable");
  process.exit(0);
}

const here = (f) => path.join(__dirname, f);
const src = fs.readFileSync(here("index.html"), "utf8");
const m = src.match(/<script[^>]*id="app-source"[^>]*>([\s\S]*?)<\/script>/);
if (!m) { console.error("app boot: could not find the #app-source script"); process.exit(1); }

global.window = global;
require(here("site-config.js"));
require(here("image-prompt.js"));
// The app reads this at its top level, which is the whole reason bootApp loads
// the config before compiling the source.
global.__SITE_CONFIG__ = window.SiteConfig.clone(window.SiteConfig.DEFAULTS);

const noop = () => {};
global.React = new Proxy({
  useState: () => [undefined, noop], useEffect: noop, useRef: () => ({ current: null }),
  useMemo: (f) => f(), useCallback: (f) => f, createElement: noop, Fragment: "Fragment",
  Component: class {}, PureComponent: class {},
}, { get: (t, k) => (k in t ? t[k] : noop) });
global.ReactDOM = { createRoot: () => ({ render: noop }), render: noop };
global.document = {
  getElementById: () => null, documentElement: { dataset: {} },
  addEventListener: noop, createElement: () => ({ style: {} }), body: {},
};
global.localStorage = { getItem: () => null, setItem: noop, removeItem: noop };
global.navigator = { userAgent: "node" };
global.matchMedia = () => ({ matches: false, addEventListener: noop });
global.fetch = () => Promise.reject(new Error("no network in check"));

// classic, not the automatic runtime: it has to match the in-browser
// `Babel.transform(source, { presets: ["react"] })` in bootApp, and the
// automatic one emits an ESM import that cannot be eval'd here at all.
const { code } = babel.transformSync(m[1], {
  presets: [["@babel/preset-react", { runtime: "classic" }]],
  filename: "app.jsx",
});

try {
  (0, eval)(code);
  console.log("app boot: top level evaluates");
} catch (e) {
  console.error("app boot: TOP LEVEL THREW — the app would show a black page");
  console.error("  " + e.constructor.name + ": " + e.message);
  process.exit(1);
}
