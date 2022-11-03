const packages = require(`${process.env.GITHUB_WORKSPACE}/package.json`) // eslint no-var-requires: 0

module.exports = () => {
  const version = packages.dependencies['@types/express'].split('.')
  return [version[0], version[1]].join('.')
}
