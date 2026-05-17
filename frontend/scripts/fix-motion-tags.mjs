import fs from 'fs'

const files = process.argv.slice(2)
const badOpen = '<' + 'motion'
const badClose = '</' + 'motion>'
const goodOpen = '<' + String.fromCharCode(100, 105, 118)
const goodClose = '</' + String.fromCharCode(100, 105, 118) + '>'

for (const p of files) {
  let s = fs.readFileSync(p, 'utf8')
  const before = (s.match(/<\/?motion/g) || []).length
  s = s.split(badClose).join(goodClose)
  s = s.split(badOpen).join(goodOpen)
  fs.writeFileSync(p, s)
  const after = (s.match(/<\/?div/g) || []).length
  console.log(p, 'bad motion', before, 'motion div opens', after)
}
