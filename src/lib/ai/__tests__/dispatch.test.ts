describe('provider dispatch', () => {
  const ORIG = { ...process.env }
  afterEach(() => {
    process.env = { ...ORIG }
    jest.resetModules()
  })

  it('returns the deterministic provider in mock mode (Phase 1 default)', async () => {
    process.env.AI_USE_MOCK = 'true'
    jest.resetModules()
    const { getProvider } = await import('../dispatch')
    expect(getProvider().id).toBe('deterministic')
  })

  it('falls back to deterministic when selected provider is unconfigured', async () => {
    process.env.AI_USE_MOCK = 'false'
    process.env.AI_PROVIDER = 'anthropic' // not registered in Phase 1
    jest.resetModules()
    const { getProvider } = await import('../dispatch')
    expect(getProvider().id).toBe('deterministic')
  })

  it('registers only the deterministic provider in Phase 1', async () => {
    jest.resetModules()
    const { registeredProviderIds } = await import('../dispatch')
    expect(registeredProviderIds()).toEqual(['deterministic'])
  })
})
