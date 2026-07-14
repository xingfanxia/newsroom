# AC-001 Task 1 evidence: hermetic command firewall

Date: 2026-07-14

Scope: Task 1 foundation only. AC-001 remains open until Task 2 rewires and
proves the default package `test` and `verify` commands.

## Accepted implementation

- Commit: `f46cc21 test: add hermetic command firewall`
- Reviewed diff SHA-256 before and after local commit consolidation:
  `f8336f8be49e209e221c48d2ce1d182df1a614f3137c64bd654668c2afdf54a7`
- Independent review result: APPROVED after one adversarial fix pass.
- External effects: none. No production DB, R2, Cloudflare, network, deploy,
  publish, push, or package-wide legacy test command was used.

## RED evidence

The initial focused test exited 1 with both intended modules absent. Reviewer
regressions then exited 1 for all four discovered weaknesses: ANSI-colored
failure-output bypass, API/private-key leakage, IPv6 loopback rejection, and a
surviving descendant process.

## GREEN evidence

```text
bun --no-env-file test tests/verification/environment-policy.test.ts tests/verification/run-checked-command.test.ts
16 pass, 0 fail, 74 assertions

bun --no-env-file run typecheck
exit 0

focused ESLint over the Task 1 TypeScript files
exit 0
```

The accepted primitive disables Bun env-file loading, strips inherited
production-capable credentials, admits only explicit local/fake overrides,
redacts secret values, grades normalized captured output, requires a completion
sentinel, bounds deadlines, and terminates the Unix process group on timeout.
