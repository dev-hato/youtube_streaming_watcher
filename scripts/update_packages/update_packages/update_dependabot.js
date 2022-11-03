const fs = require('fs')
const yaml = require('js-yaml')

module.exports = () => {
  const configFilename = `${process.env.GITHUB_WORKSPACE}.github/dependabot.yml`
  const config = yaml.load(fs.readFileSync(configFilename, 'utf8'))

  for (const update of config.updates) {
    if (update['package-ecosystem'] === 'npm') {
      for (const ignore of update.ignore) {
        if (ignore['dependency-name'] === 'express') {
          ignore.versions[0] = `>${process.env.TYPES_EXPRESS_VERSION}`
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
}
