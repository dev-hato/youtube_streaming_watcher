const fs = require('fs')
const yaml = require('js-yaml')
const renovate = require(`${process.env.GITHUB_WORKSPACE}/renovate.json`)

module.exports = () => {
  const configFilename = `${process.env.GITHUB_WORKSPACE}/.github/dependabot.yml`
  const config = yaml.load(fs.readFileSync(configFilename, 'utf8'))

  for (const update of config.updates) {
    if (update['package-ecosystem'] === 'docker') {
      for (const ignore of update.ignore) {
        if (ignore['dependency-name'] === 'node') {
          ignore.versions[0] = `>${process.env.TYPE_NODE_VERSION}`
        }
      }
    }
  }

  try {
    fs.writeFileSync(configFilename, '---\n' + yaml.dump(config), 'utf8')
  } catch (err) {
    console.error(err.message)
    process.exit(1)
  }

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
