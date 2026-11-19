export function resolveServerDaoContractId(env = process.env) {
  for (const deprecatedName of ['HELPHONE_CONTRACT_ID', 'CONTRACT_ID']) {
    const deprecatedValue = env[deprecatedName]
    if (!deprecatedValue) continue
    console.warn(
      `[DEPRECATED] ${deprecatedName} is deprecated; use HELPHONE_DAO_ID for the selected Stellar network.`,
    )
    if (!env.HELPHONE_DAO_ID) return deprecatedValue
  }
  return env.HELPHONE_DAO_ID
}
