# Security Policy

## Supported versions

sabit is pre-1.0. Security fixes are released for the latest minor version
of each published package.

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report vulnerabilities through GitHub's private vulnerability reporting: open
the repository's **Security** tab and choose **Report a vulnerability**.

Please include:

- the affected package(s) and version(s),
- a description of the issue and its impact,
- steps or a minimal route tree that reproduces it.

You'll get an acknowledgement within 3 business days. We'll keep you updated as
we investigate, agree on a disclosure date with you, and credit you in the
release notes unless you prefer otherwise.

## Scope notes

sabit runs inside your framework. Issues in Express, Hono, Fastify or
NestJS themselves should be reported to those projects. Issues in how
sabit parses paths, params, bodies or headers, or in how it composes
middleware (for example, a way to skip a directory's middleware), are in scope.
