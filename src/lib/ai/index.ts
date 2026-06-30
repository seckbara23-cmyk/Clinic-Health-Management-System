// CHMS Intelligence Platform — public barrel for the AI core.
export * from './types'
export * from './config'
export { getProvider, registeredProviderIds } from './dispatch'
export { deterministicProvider } from './providers/deterministic'
export {
  ALL_TOOLS,
  getTool,
  toolsForRole,
  selectToolsForContext,
} from './tools'
export { SKILLS, skillForRole } from './skills'
export { runCopilot } from './context'
export type { CopilotResult } from './context'
