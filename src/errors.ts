/**
 * Typed errors for the collector.
 * Plain classes only — no parameter properties (erasableSyntaxOnly).
 */

export class CollectorError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CollectorError";
    this.code = code;
  }
}

export class GitHubHttpError extends CollectorError {
  readonly status: number;

  constructor(status: number, message: string) {
    super(`github_http_${status}`, message);
    this.name = "GitHubHttpError";
    this.status = status;
  }
}
