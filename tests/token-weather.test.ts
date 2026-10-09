import { expect, test } from 'claude-code/testing'

const PROPS = { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 100 }

for (const surface of ['terminal', 'desktop'] as const) {
  test(`forecast moves from Clear to Showers on ${surface}`, async ($, on) => {
    let tokens = 20_000
    on('session.usage', () => ({
      value: {
        startedAt: 0,
        rateLimits: [],
        context: { tokens, window: 200_000, percent: Math.round((tokens / 200_000) * 100) },
      },
    }) as never)
    on('session.start', (_$, e) => ({ cwd: e.cwd }))
    on('turn.complete', () => ({ text: '' }))
    on('ui.render', () => null as never)

    await $.session.start({ cwd: 'D:/Dev', surface, isInteractive: true })
    const band = () => $.ui.mount({ plugin: 'token-weather', surface, component: 'AbovePrompt', props: PROPS })

    let ui = await band()
    expect(await ui.find({ text: /Clear/ })).toBeDefined()
    expect(await ui.find({ text: /10% · 20k\/200k/ })).toBeDefined()

    tokens = 134_000
    await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    ui = await band()
    expect(await ui.find({ text: /Showers/ })).toBeDefined()
    expect(await ui.find({ text: /Clear/ })).toBeUndefined()
    expect(await ui.find({ text: /67% · 134k\/200k/ })).toBeDefined()
  })
}
