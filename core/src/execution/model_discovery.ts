// ============================================================================
// KIN DYNAMIC LOCAL & EXTERNAL MODEL DISCOVERY SERVICE
// Probes local and remote LLM endpoints, mapping capabilities & pricing.
// Aligned with PRD § 8 and TRD § 7.
// ============================================================================

export interface DiscoveredModel {
  id: string;
  name: string;
  provider: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  supportsTools?: boolean;
  supportsVision?: boolean;
  supportsReasoning?: boolean;
  isFree?: boolean;
  description?: string;
  isCustom?: boolean;
  configured?: boolean;
  validated?: boolean;
  pricing?: {
    prompt?: number | string;
    completion?: number | string;
  };
}

export interface ProviderReadiness {
  provider: string;
  configured: boolean;
  validated: boolean;
  ready?: boolean;
  keyCount?: number;
  modelCount: number;
  message?: string;
}

export class ModelDiscoveryService {
  public static mapModelCapabilities(modelId: string, rawData?: any): Partial<DiscoveredModel> {
    const idLower = modelId.toLowerCase();
    const supportsVision = Boolean(
      idLower.includes('vision') ||
      idLower.includes('vl') ||
      idLower.includes('4o') ||
      idLower.includes('claude-3') ||
      idLower.includes('gemini-1.5') ||
      idLower.includes('gemini-2') ||
      rawData?.architecture?.modality?.includes('image')
    );

    const supportsReasoning = Boolean(
      idLower.includes('r1') ||
      idLower.includes('o1') ||
      idLower.includes('o3') ||
      idLower.includes('reason') ||
      idLower.includes('thinking') ||
      idLower.includes('deepseek-r1')
    );

    const supportsTools = !Boolean(
      idLower.includes('base') ||
      idLower.includes('instruct-eval')
    );

    return {
      supportsVision,
      supportsReasoning,
      supportsTools,
    };
  }

  public static parsePricing(rawPricing: any): { prompt?: number | string; completion?: number | string } | undefined {
    if (!rawPricing || typeof rawPricing !== 'object') return undefined;
    return {
      prompt: rawPricing.prompt,
      completion: rawPricing.completion,
    };
  }
}
