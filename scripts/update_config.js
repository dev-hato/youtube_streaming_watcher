const fs = require('fs')
const yaml = require('js-yaml')
const renovate = require(`${process.env.GITHUB_WORKSPACE}/renovate.json`)

module.exports = () => {
  const configFilename = `${process.env.GITHUB_WORKSPACE}/.github/dependabot.yml`
  const config = yaml.load(fs.readFileSync(configFilename, 'utf8'))

  for (const update of config.updates) {
    if (update['package-ecosystem'] === process.env.PACKAGE_ECOSYSTEM) {
      for (const ignore of update.ignore) {
        if (ignore['dependency-name'] === process.env.MATCH_PACKAGE_NAME) {
          ignore.versions[0] = `>${process.env.MAX_ALLOWED_VERSION}`
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
    if (rule.matchPackageNames.includes(process.env.MATCH_PACKAGE_NAME)) {
      rule.allowedVersions = `<=${process.env.MAX_ALLOWED_VERSION}`
    }
  }

  try {
    fs.writeFileSync(`${process.env.GITHUB_WORKSPACE}/renovate.json`, JSON.stringify(renovate, null, '  ') + '\n', 'utf8')
  } catch (err) {
    console.error(err.message)
    process.exit(1)
  }
}
