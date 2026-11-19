// Tiny check runner shared by the DROP server test suites.
// Each check is one named assertion; the suite prints PASS/FAIL per
// check and a totals line, and exits non-zero when anything fails.

export interface Runner {
  check(name: string, fn: () => boolean | void | Promise<boolean | void>): Promise<void>;
  finish(): void;
}

export function createRunner(suiteName: string): Runner {
  let pass = 0;
  let fail = 0;
  const failures: string[] = [];
  return {
    async check(name, fn) {
      try {
        const r = await fn();
        if (r === false) throw new Error('check returned false');
        pass++;
        console.log(`  PASS ${name}`);
      } catch (err: any) {
        fail++;
        failures.push(name);
        console.log(`  FAIL ${name} — ${err?.message ?? err}`);
      }
    },
    finish() {
      console.log(`[${suiteName}] ${pass} passed, ${fail} failed, ${pass + fail} total`);
      if (failures.length > 0) {
        console.log(`[${suiteName}] failures: ${failures.join(' | ')}`);
        process.exitCode = 1;
      }
    },
  };
}

/** Assert helper: throws with a message naming the mismatch. */
export function eq(actual: any, expected: any, label = ''): void {
  if (actual !== expected) {
    throw new Error(`${label ? label + ': ' : ''}expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

export function ok(value: any, label = ''): void {
  if (!value) throw new Error(`${label ? label + ': ' : ''}expected truthy, got ${JSON.stringify(value)}`);
}
