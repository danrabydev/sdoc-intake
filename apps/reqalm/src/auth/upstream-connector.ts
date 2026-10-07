/**
 * Pluggable upstream IdP connector seam (ARCH-AUTH-UPSTREAM-CONNECTOR).
 * OIDC/SAML implementations are deferred; this module defines the contract only.
 */

export type UpstreamConnectorConfig = {
  id: string;
  clientId: string;
  protocol: "oidc" | "saml";
  issuer?: string;
  enabled: boolean;
};

export type UpstreamAuthResult = {
  externalSub: string;
  email?: string;
  displayName?: string;
  amr?: string[];
  acr?: string;
};

export interface UpstreamConnector {
  readonly id: string;
  startAuthorization(returnUrl: string): Promise<{ redirectUrl: string }>;
  handleCallback(params: URLSearchParams): Promise<UpstreamAuthResult>;
  handleBackChannelLogout?(payload: unknown): Promise<void>;
}

export class StubUpstreamConnector implements UpstreamConnector {
  constructor(public readonly config: UpstreamConnectorConfig) {
    this.id = config.id;
  }
  readonly id: string;

  async startAuthorization(_returnUrl: string): Promise<{ redirectUrl: string }> {
    throw new Error(
      "Upstream federation is not configured in this slice (connector stub only)",
    );
  }

  async handleCallback(_params: URLSearchParams): Promise<UpstreamAuthResult> {
    throw new Error("Upstream federation callback not implemented");
  }
}
