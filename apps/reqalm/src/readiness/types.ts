export type CheckResult = {
  ok: boolean;
  detail?: string;
};

export type ReadinessReport = {
  ready: boolean;
  roles: string[];
  checks: Record<string, CheckResult>;
};
