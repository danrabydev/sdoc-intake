/**
 * Capture catalog browse UI PNGs at 1280px width against PGlite + dogfood seed.
 * Usage: node --import tsx scripts/capture-catalog-browse-screenshots.mjs [--port N] [--out-dir PATH]
 * Env: REQALM_CAPTURE_PORT | REQALM_PORT (default 3000), CATALOG_SCREENSHOT_DIR (default /opt/cursor/artifacts/screenshots)
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer-core";

const VIEWPORT = { width: 1280, height: 900 };
const DEFAULT_PORT = 3000;
const DEFAULT_OUT_DIR = "/opt/cursor/artifacts/screenshots";

function parseCaptureConfig() {
  let port = Number(process.env.REQALM_CAPTURE_PORT ?? process.env.REQALM_PORT ?? DEFAULT_PORT);
  let outDir = process.env.CATALOG_SCREENSHOT_DIR ?? DEFAULT_OUT_DIR;
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--port" && args[i + 1]) port = Number(args[++i]);
    else if (args[i] === "--out-dir" && args[i + 1]) outDir = args[++i];
    else if (args[i] === "--help" || args[i] === "-h") {
      console.log(`Usage: capture-catalog-browse-screenshots.mjs [--port ${DEFAULT_PORT}] [--out-dir ${DEFAULT_OUT_DIR}]`);
      process.exit(0);
    }
  }
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    throw new Error(`invalid port: ${port}`);
  }
  return { port, outDir };
}

const NIST_CAT = "cat-nist-global";
const NIST_IMP = "nist-800-53@rev5-dogfood-20261006";
const PROJECT = "reqalm";
const PRIV_CAT = "cat-priv-visible";
const PRIV_IMP = "imprint-priv-only";
const EMPTY_LIST_PROJECT = PROJECT;

/** Encode path segments so `@` in imprint ids is not parsed as URL userinfo. */
function appPath(...segments) {
  return `/${["app", ...segments].map((s) => encodeURIComponent(s)).join("/")}`;
}

const SHOTS = [
  {
    file: "catalog-list.png",
    path: appPath("projects", PROJECT, "catalogs"),
    ready: (page) => page.waitForSelector("table.data-table", { timeout: 60_000 }),
  },
  {
    file: "catalog-imprint-detail-grouped-by-family.png",
    path: appPath("projects", PROJECT, "catalogs", NIST_CAT, "imprints", NIST_IMP),
    fullPage: true,
    ready: (page) => page.waitForSelector(".catalog-family-heading", { timeout: 60_000 }),
  },
  {
    file: "catalog-control-detail-with-chips.png",
    path: appPath("projects", PROJECT, "catalogs", NIST_CAT, "imprints", NIST_IMP, "controls", "CM-3"),
    fullPage: true,
    ready: (page) => page.waitForSelector(".catalog-conforming-list .relation-chip-link", { timeout: 60_000 }),
  },
  {
    file: "catalog-restricted-404.png",
    path: appPath("projects", PROJECT, "catalogs", PRIV_CAT, "imprints", PRIV_IMP, "controls", "PRIV-ONLY-CTL"),
    ready: async (page) => {
      await page.waitForSelector("main h1", { timeout: 60_000 });
      const text = await page.evaluate(() => document.querySelector("main")?.textContent ?? "");
      if (!/not found/i.test(text)) throw new Error(`expected restricted copy, got: ${text.slice(0, 120)}`);
    },
  },
  {
    file: "catalog-empty-state.png",
    path: appPath("projects", EMPTY_LIST_PROJECT, "catalogs"),
    beforeCapture: async (pool) => hideAllCatalogsFromProject(pool, EMPTY_LIST_PROJECT),
    ready: async (page) => {
      await page.waitForSelector(".empty-state", { timeout: 60_000 });
      const text = await page.evaluate(() => document.querySelector(".empty-state")?.textContent ?? "");
      if (!text.includes("No catalogs visible")) {
        throw new Error(`unexpected empty copy: ${text}`);
      }
    },
  },
];

async function seedScreenshotFixtures(pool) {
  await pool.query(`
    INSERT INTO projects (id, client_id, name)
    VALUES ('cat-priv-p2', 'reqalm-client', 'Priv')
    ON CONFLICT DO NOTHING;
    INSERT INTO catalog_defs (id, is_standard, project_id, title)
    VALUES ('${PRIV_CAT}', false, 'cat-priv-p2', 'Private stew')
    ON CONFLICT DO NOTHING;
    INSERT INTO catalog_imprints (id, catalog_id, version_label, status)
    VALUES ('${PRIV_IMP}', '${PRIV_CAT}', 'v1', 'published')
    ON CONFLICT DO NOTHING;
    INSERT INTO catalog_item_labels (catalog_id, item_uid, title, family)
    VALUES ('${PRIV_CAT}', 'PRIV-ONLY-CTL', 'Private ctl', 'X')
    ON CONFLICT DO NOTHING;
    INSERT INTO project_grants (id, project_id, identity_id, role)
    VALUES ('grant-casey-cat-priv', 'cat-priv-p2', 'casey-reader', 'Reader')
    ON CONFLICT DO NOTHING;
  `);
}

/** Standard catalogs are visible on every granted project; re-home defs so reqalm list is truly empty. */
async function hideAllCatalogsFromProject(pool, projectId) {
  await pool.query(
    `
    INSERT INTO projects (id, client_id, name)
    VALUES ('catalog-screenshot-owner', 'reqalm-client', 'Catalog screenshot owner')
    ON CONFLICT DO NOTHING;
    UPDATE catalog_defs
    SET is_standard = false, project_id = 'catalog-screenshot-owner';
  `,
  );
  const check = await pool.query(
    `SELECT COUNT(*)::int AS n FROM catalog_defs cd
     WHERE cd.is_standard OR cd.project_id = $1`,
    [projectId],
  );
  if (check.rows[0].n !== 0) {
    throw new Error(`expected zero visible catalog defs for ${projectId}`);
  }
}

async function issueWebSessionCookies(app, port, base) {
  const inject = (opts) =>
    app.inject({
      ...opts,
      remoteAddress: "203.0.113.50",
      headers: { host: `localhost:${port}`, ...(opts.headers || {}) },
    });
  const start = await inject({ method: "GET", url: "/oauth/web/start" });
  if (start.statusCode !== 302) throw new Error(`web/start ${start.statusCode}`);
  const authz = await inject({ method: "GET", url: String(start.headers.location ?? "") });
  if (authz.statusCode !== 302) {
    throw new Error(`authorize ${authz.statusCode}: ${authz.body}`);
  }
  const loginPath = authz.headers.location;
  const h = new URL(loginPath, base).searchParams.get("h");
  if (!h) throw new Error("missing handoff");
  const login = await inject({
    method: "POST",
    url: "/api/v1/auth/local/login",
    headers: { "content-type": "application/json" },
    payload: { username: "casey-reader@dev.local", password: TEST_PASSWORD, h },
  });
  if (login.statusCode !== 200) throw new Error(`login ${login.statusCode}: ${login.body}`);
  const setCookie = login.headers["set-cookie"];
  const pairs = (Array.isArray(setCookie) ? setCookie : [setCookie])
    .filter(Boolean)
    .map((c) => {
      const [nameValue, ...rest] = String(c).split(";");
      const eq = nameValue.indexOf("=");
      return {
        name: nameValue.slice(0, eq),
        value: nameValue.slice(eq + 1),
        domain: "localhost",
        path: "/",
        httpOnly: /httponly/i.test(rest.join(";")),
        secure: false,
      };
    });
  return pairs;
}

async function capture(page, spec, base, outDir) {
  await page.setViewport(VIEWPORT);
  await page.goto(`${base}${spec.path}`, { waitUntil: "load", timeout: 120_000 });
  await spec.ready(page);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const outPath = path.join(outDir, spec.file);
  const fullPage = spec.fullPage === true;
  await page.screenshot({ path: outPath, type: "png", fullPage });
  return outPath;
}

async function main() {
  const { port, outDir } = parseCaptureConfig();
  process.env.REQALM_PORT = String(port);
  const base = `http://localhost:${port}`;
  const { createTestApp, TEST_PASSWORD } = await import("../src/test/harness.ts");

  await mkdir(outDir, { recursive: true });
  const ctx = await createTestApp({ dogfood: true });
  await seedScreenshotFixtures(ctx.pool);
  await ctx.app.listen({ port, host: "127.0.0.1" });
  const cookies = await issueWebSessionCookies(ctx.app, port, base);

  const chrome =
    process.env.CHROME_PATH ??
    "/usr/local/bin/google-chrome";
  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    defaultViewport: VIEWPORT,
  });

  const written = [];
  try {
    const page = await browser.newPage();
    page.on("console", (msg) => {
      if (msg.type() === "error") console.error("browser:", msg.text());
    });
    await page.setCookie(...cookies);
    for (const spec of SHOTS) {
      if (spec.beforeCapture) await spec.beforeCapture(ctx.pool);
      const p = await capture(page, spec, base, outDir);
      written.push(p);
      console.log("wrote", p);
    }
  } finally {
    await browser.close();
    await ctx.app.close();
    await ctx.close();
  }

  await writeFile(
    path.join(outDir, "catalog-browse-screenshots.json"),
    `${JSON.stringify({ width: VIEWPORT.width, files: SHOTS.map((s) => s.file), paths: written }, null, 2)}\n`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
