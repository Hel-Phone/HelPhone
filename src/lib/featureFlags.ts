import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import type {
  FeatureFlagConfig,
  FeatureFlagRuleset,
  UserContext,
  FlagEvaluationResult,
} from '../types/index.js'

// Deterministic hashing for percentage rollouts (0 - 99)
export function hashString(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash |= 0 // Convert to 32bit integer
  }
  return Math.abs(hash) % 100
}

export class FeatureFlagEvaluator {
  private config: FeatureFlagConfig | null = null
  private defaultContext: UserContext = { environment: 'production' }

  constructor(initialConfig?: FeatureFlagConfig) {
    if (initialConfig) {
      this.config = initialConfig
    }
  }

  public setConfig(config: FeatureFlagConfig): void {
    this.config = config
  }

  public getConfig(): FeatureFlagConfig | null {
    return this.config
  }

  public async fetchRemoteConfig(configUrl = '/config.json'): Promise<FeatureFlagConfig | null> {
    try {
      const response = await fetch(configUrl)
      if (response.ok) {
        const data = (await response.json()) as FeatureFlagConfig
        this.config = data
        return data
      }
    } catch (err) {
      console.warn('[FeatureFlagEvaluator] Remote config fetch failed, using defaults:', err)
    }
    return this.config
  }

  public evaluateFlag(flagKey: string, userContext?: UserContext): FlagEvaluationResult {
    const context = { ...this.defaultContext, ...userContext }
    const userIdentifier = context.id || context.deviceId || 'anonymous-device'
    const env = context.environment || 'production'

    // 1. Environment Variable Override (e.g. VITE_FLAG_EMERGENCY_BROADCASTER=true)
    const envVarKey = `VITE_FLAG_${flagKey.toUpperCase()}`
    const metaEnv = (import.meta as any).env
    if (metaEnv && metaEnv[envVarKey] !== undefined) {
      const envValue = metaEnv[envVarKey] === 'true' || metaEnv[envVarKey] === '1'
      return { flagKey, enabled: envValue, reason: 'env_override' }
    }

    if (!this.config || !this.config.flags || !this.config.flags[flagKey]) {
      return { flagKey, enabled: false, reason: 'default' }
    }

    const ruleset: FeatureFlagRuleset = this.config.flags[flagKey]

    // 2. Global Disabled Check
    if (!ruleset.enabled) {
      return { flagKey, enabled: false, reason: 'disabled' }
    }

    // 3. Environment Specific Overrides in Ruleset
    if (ruleset.environmentOverrides && ruleset.environmentOverrides[env] !== undefined) {
      return { flagKey, enabled: ruleset.environmentOverrides[env], reason: 'env_override' }
    }

    // 4. Target Matching (Roles / Environments / User IDs)
    if (ruleset.targets) {
      if (ruleset.targets.userIds && context.id && ruleset.targets.userIds.includes(context.id)) {
        return { flagKey, enabled: true, reason: 'target_match' }
      }
      if (ruleset.targets.roles && context.role && !ruleset.targets.roles.includes(context.role)) {
        return { flagKey, enabled: false, reason: 'disabled' }
      }
      if (ruleset.targets.environments && env && !ruleset.targets.environments.includes(env)) {
        return { flagKey, enabled: false, reason: 'disabled' }
      }
    }

    // 5. Percentage Canary Rollouts
    const rolloutPercentage = ruleset.rolloutPercentage ?? 100
    if (rolloutPercentage >= 100) {
      return { flagKey, enabled: true, reason: 'percentage_rollout' }
    }
    if (rolloutPercentage <= 0) {
      return { flagKey, enabled: false, reason: 'percentage_rollout' }
    }

    const userHash = hashString(`${userIdentifier}:${flagKey}`)
    const isBucketEnabled = userHash < rolloutPercentage

    return { flagKey, enabled: isBucketEnabled, reason: 'percentage_rollout' }
  }
}

// Global Evaluator Singleton Instance
export const defaultEvaluator = new FeatureFlagEvaluator()

interface FeatureFlagContextValue {
  evaluator: FeatureFlagEvaluator
  config: FeatureFlagConfig | null
  userContext: UserContext
  setUserContext: (ctx: UserContext) => void
  refreshConfig: () => Promise<void>
}

const FeatureFlagContext = createContext<FeatureFlagContextValue | undefined>(undefined)

export const FeatureFlagProvider: React.FC<{
  children: ReactNode
  initialConfig?: FeatureFlagConfig
  configUrl?: string
  defaultUserContext?: UserContext
}> = ({ children, initialConfig, configUrl = '/config.json', defaultUserContext }) => {
  const [evaluator] = useState(() => new FeatureFlagEvaluator(initialConfig))
  const [config, setConfig] = useState<FeatureFlagConfig | null>(initialConfig || null)
  const [userContext, setUserContext] = useState<UserContext>(
    defaultUserContext || { environment: 'production' }
  )

  const refreshConfig = async () => {
    const fetched = await evaluator.fetchRemoteConfig(configUrl)
    if (fetched) setConfig(fetched)
  }

  useEffect(() => {
    refreshConfig()
  }, [configUrl])

  return React.createElement(
    FeatureFlagContext.Provider,
    { value: { evaluator, config, userContext, setUserContext, refreshConfig } },
    children
  )
}

export function useFeatureFlags() {
  const context = useContext(FeatureFlagContext)
  if (!context) {
    throw new Error('useFeatureFlags must be used within a FeatureFlagProvider')
  }
  return context
}

export function useFeatureFlag(flagKey: string, userContextOverride?: UserContext): boolean {
  const context = useContext(FeatureFlagContext)
  if (!context) {
    return defaultEvaluator.evaluateFlag(flagKey, userContextOverride).enabled
  }

  const effectiveContext = userContextOverride || context.userContext
  return context.evaluator.evaluateFlag(flagKey, effectiveContext).enabled
}
