import type { Register } from 'claude-code'

import { maskDeep, maskText, resultText, unique } from './secrets'
import type { Secret } from './secrets'

// Desktop app only: API keys, tokens and passwords in Claude's replies and in
// tool rows are drawn as •••••••• ; hovering the line under the row shows them.
// Display only: what the model reads is unchanged.

const MAX_SHOWN = 20_000

export const register: Register = on => {
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.surface !== 'desktop') return next(e)
    const masked = maskText(e.props.text)
    if (masked.secrets.length === 0) return next(e)

    const { Box, Markdown, Text } = $.ui.resolve(e)
    const secrets = unique(masked.secrets)

    return (
      <Box flexDirection="column">
        <Markdown text={masked.value} />
        <Box key="hover-reveal" flexDirection="column">
          <Text dimColor>
            🔒 {secrets.length} hidden {secrets.length === 1 ? 'value' : 'values'} · hover to show
          </Text>
          <Box display="none" hover={{ display: 'flex' }} flexDirection="column">
            {secrets.map((s: Secret) => (
              <Text>
                <Text dimColor>{s.label}: </Text>
                {s.value}
              </Text>
            ))}
          </Box>
        </Box>
      </Box>
    )
  })

  // The call's row: its input (a command holding a token) and, in an
  // expanded group, its output, masked in place in the engine's own row.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (e.surface !== 'desktop') return next(e)
    const input = maskDeep(e.props.input)
    const output = maskDeep(e.props.output)
    if (input.secrets.length === 0 && output.secrets.length === 0) return next(e)
    return next({ ...e, props: { ...e.props, input: input.value, output: output.value } })
  })

  // The result under a row. Where it holds a secret, the mod draws the result
  // itself (masked text, then the hover line), so the value is never drawn.
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (e.surface !== 'desktop' || e.props.isErrored) return next(e)
    const masked = maskText(resultText(e.props.output))
    if (masked.secrets.length === 0) return next(e)

    const { Box, Code, Text } = $.ui.resolve(e)
    const secrets = unique(masked.secrets)

    return (
      <Box flexDirection="column">
        <Code source={masked.value.slice(0, MAX_SHOWN)} />
        <Box key="hover-reveal" flexDirection="column">
          <Text dimColor>
            🔒 {secrets.length} hidden {secrets.length === 1 ? 'value' : 'values'} · hover to show
          </Text>
          <Box display="none" hover={{ display: 'flex' }} flexDirection="column">
            {secrets.map((s: Secret) => (
              <Text>
                <Text dimColor>{s.label}: </Text>
                {s.value}
              </Text>
            ))}
          </Box>
        </Box>
      </Box>
    )
  })
}
