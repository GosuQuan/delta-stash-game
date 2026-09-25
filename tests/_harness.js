"use strict";
/** Shared jsdom harness for the hall-crate / eval tests (real index.html + style.css + game.js). */
const fs = require("fs");
const path = require("path");
let JSDOM;
try { ({ JSDOM } = require("jsdom")); } catch (_) {
  console.error("jsdom missing — run `npm install` (devDependency) first."); process.exit(2);
}
const DIR = process.env.GAME_DIR || path.join(__dirname, "..");

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** opts: { seed, url, hook, storage: {k:v}, beforeBoot(w) } */
function makeWorld(opts = {}) {
  const css = fs.readFileSync(path.join(DIR, "style.css"), "utf8");
  const html = fs.readFileSync(path.join(DIR, "index.html"), "utf8")
    .replace(/<script[^>]*src=[^>]*><\/script>/g, "")
    .replace(/<link[^>]*rel="stylesheet"[^>]*>/, `<style>[hidden]{display:none}</style><style>${css}</style>`);
  const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: opts.url || "https://example.test/" });
  const w = dom.window;
  const rs = setTimeout, rc = clearTimeout;
  w.setTimeout = (f, _ms, ...a) => rs(() => f(...a), 0);
  w.clearTimeout = (id) => rc(id);
  w.setInterval = () => 0; w.clearInterval = () => {};
  w.requestAnimationFrame = (f) => rs(() => f(Date.now()), 0);
  w.cancelAnimationFrame = (id) => rc(id);
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  w.HTMLCanvasElement.prototype.getContext = () => null;
  w.fetch = () => Promise.reject(new Error("offline"));
  w.confirm = () => true;
  w.sessionStorage.setItem("auctionHelpSeen", "1");
  for (const [k, v] of Object.entries(opts.storage || {})) w.localStorage.setItem(k, v);
  w.console.warn = () => {}; w.console.log = () => {};
  w.eval(`Math.random = (${mulberry32.toString()})(${opts.seed || 1});`);
  const src = fs.readFileSync(path.join(DIR, "game.js"), "utf8");
  const end = src.lastIndexOf("})();");
  if (end < 0) throw new Error("game.js IIFE close not found");
  w.eval(src.slice(0, end) + (opts.hook || "") + src.slice(end));
  return w;
}

const tick = () => new Promise((r) => setTimeout(r, 0));
async function waitFor(pred, max = 20000) { for (let i = 0; i < max; i++) { if (pred()) return true; await tick(); } return false; }

function rendered(w, node) {
  for (let n = node; n && n.nodeType === 1; n = n.parentElement) {
    if (w.getComputedStyle(n).display === "none") return false;
  }
  return !!node;
}

function makeChecker() {
  const st = { pass: 0, fail: 0, failures: [] };
  st.check = (cond, msg) => { if (cond) st.pass++; else { st.fail++; st.failures.push(msg); } };
  st.done = (label) => {
    console.log(`${label}: pass=${st.pass} fail=${st.fail}`);
    if (st.fail) { console.log(st.failures.slice(0, 40).map((f) => "  FAIL " + f).join("\n")); process.exit(1); }
    console.log("OK");
  };
  return st;
}

module.exports = { makeWorld, waitFor, tick, rendered, makeChecker, mulberry32, DIR };
