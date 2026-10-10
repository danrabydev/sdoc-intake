/** Dev/test-only: fail fast if a PGlite fixture is left open (avoids hung follow-on runs). */
let openFixtures = 0;

export function notePglitePoolOpened(): void {
  openFixtures += 1;
}

export function notePglitePoolClosed(): void {
  openFixtures = Math.max(0, openFixtures - 1);
}

export function openPgliteFixtureCount(): number {
  return openFixtures;
}

process.on("beforeExit", () => {
  if (openFixtures > 0) {
    console.error(
      `error: ${openFixtures} PGlite test fixture(s) still open — ensure pool.close() runs in a finally block`,
    );
    process.exitCode = 1;
  }
});
