const fs = require('fs')
const renovate = require(`${process.env.GITHUB_WORKSPACE}/renovate.json`) // eslint no-var-requires: 0

module.exports = () => {
  for (const rule of renovate.packageRules) {
    if (rule.matchPackageNames.includes('node')) {
      rule.allowedVersions = `<=${process.env.TYPE_NODE_VERSION}`
    }
  }

  try {
    fs.writeFileSync(`${process.env.GITHUB_WORKSPACE}/renovate.json`, JSON.stringify(renovate, null, '  ') + '\n', 'utf8')
  } catch (err) {
    console.error(err.message)
    process.exit(1)
  }
}
