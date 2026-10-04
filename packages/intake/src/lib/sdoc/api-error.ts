import type { SDocIssue } from "./types.ts";

export class ApiError extends Error {
  readonly status: number;
  readonly errors: SDocIssue[];

  constructor(status: number, message: string, errors: SDocIssue[] = []) {
    super(message);
    this.status = status;
    this.errors = errors;
  }
}
