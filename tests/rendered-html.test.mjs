import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost:1111/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the interactive Middle-earth atlas shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Middle-earth — An Interactive Atlas<\/title>/i);
  assert.match(html, /aria-label="Interactive map of Middle-earth"/);
  assert.match(html, /aria-label="Three-dimensional terrain of Middle-earth"/);
  assert.match(html, /Raising the mountains…/);
  assert.match(html, /Choose a journey/);
  assert.match(html, /aria-label="Begin journey"/);
  assert.match(html, /The Fellowship/);
  assert.doesNotMatch(html, /Your site is taking shape|Building your site/);
});

test("keeps the WebGL terrain and port configuration integrated", async () => {
  const [scene, page, css, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/TerrainScene.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(scene, /from "three"/);
  assert.match(scene, /displacementMap:\s*heightTexture/);
  assert.match(scene, /middle-earth-heightmap\.png/);
  assert.match(scene, /makeTraveler/);
  assert.match(scene, /requestAnimationFrame/);
  assert.match(page, /<TerrainScene/);
  assert.match(page, /activeJourney\.path/);
  assert.match(css, /\.terrain-scene\.ready canvas/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(layout, /Middle-earth — An Interactive Atlas/);
  assert.match(packageJson, /"three":/);
  assert.match(packageJson, /vinext dev --port 1111/);
  assert.match(packageJson, /vinext start --port 1111/);
  assert.doesNotMatch(packageJson, /--port 3000/);
});
