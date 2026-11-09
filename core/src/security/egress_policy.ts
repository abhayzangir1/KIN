// ============================================================================
// KIN SECURITY: AGENT CREDENTIAL SCOPING & CLOUD EGRESS CONSENT POLICY
// Enforces PRD § 12 least-privilege credential access and explicit egress opt-in.
// Strict default-deny: no agent accesses cloud credentials unless explicitly granted.
// ============================================================================

export interface ProviderCredential {
  id: string;
  provider: string;
  scopedAgentIds: string[];
}

export interface EgressConsentSettings {
  masterEgressEnabled: boolean;
  allowPrompts: boolean;
  allowSharedMemory: boolean;
  allowPrivateNotes: boolean;
  allowDirectMessages: boolean;
}

/**
 * Checks whether an agent is explicitly authorized to access a provider credential.
 * Enforces strict default-deny when scopedAgentIds is empty.
 * Wildcard ('*') permits universal access.
 */
export function isAgentAuthorizedForCredential(
  cred: ProviderCredential,
  requestingAgentId: string
): boolean {
  if (!cred.scopedAgentIds || cred.scopedAgentIds.length === 0) {
    // Strict default-deny: no agents permitted if scopedAgentIds is empty
    return false;
  }
  if (cred.scopedAgentIds.includes('*')) {
    // Universal access granted to all agents
    return true;
  }
  return cred.scopedAgentIds.includes(requestingAgentId);
}

/**
 * Evaluates whether a data category is permitted to egress to cloud LLMs based on operator consent.
 * If masterEgressEnabled is false, all egress is unconditionally blocked.
 */
export function canEgressData(
  type: 'prompt' | 'privateNote' | 'dm' | 'sharedMemory',
  consent: EgressConsentSettings
): boolean {
  if (!consent.masterEgressEnabled) {
    return false;
  }
  if (type === 'prompt') return Boolean(consent.allowPrompts);
  if (type === 'privateNote') return Boolean(consent.allowPrivateNotes);
  if (type === 'dm') return Boolean(consent.allowDirectMessages);
  if (type === 'sharedMemory') return Boolean(consent.allowSharedMemory);
  return false;
}
