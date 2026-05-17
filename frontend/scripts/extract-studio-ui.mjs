/**
 * One-off helper: extracts JSX blocks from Home.tsx into studio feature components.
 * Run: node scripts/extract-studio-ui.mjs
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const homePath = path.join(root, 'src/pages/Home.tsx')
const outDir = path.join(root, 'src/features/studio')
const lines = fs.readFileSync(homePath, 'utf8').split(/\r?\n/)

function slice(start, end) {
  return lines.slice(start - 1, end).join('\n')
}

function writeComponent(filename, componentName, propsTypeName, imports, bodyLines, extra = '') {
  const body = slice(bodyLines[0], bodyLines[1])
  const content = `${imports}

export type ${propsTypeName} = Record<string, never> // replace manually

export function ${componentName}(props: ${propsTypeName}) {
${extra}
  return (
${body}
  )
}
`
  fs.writeFileSync(path.join(outDir, filename), content, 'utf8')
  console.log('wrote', filename)
}

// Only extract raw bodies for manual integration — full automation needs prop types.
const extracts = {
  'StudioResultPanel.body.txt': [2260, 2737],
  'StudioAgentChatMessageList.body.txt': [2923, 3308],
  'StudioAgentChatHeader.body.txt': [2750, 2915],
  'StudioAgentComposer.body.txt': [3310, 3720],
  'StudioLlmReviewDock.body.txt': [3755, 3896],
}

for (const [name, [a, b]] of Object.entries(extracts)) {
  fs.writeFileSync(path.join(outDir, name), slice(a, b), 'utf8')
  console.log(name, b - a + 1, 'lines')
}
