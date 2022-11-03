const packages = require(`${process.env.GITHUB_WORKSPACE}/package.json`)

module.exports = () => {
  const version = packages.dependencies['@types/express'].split('.')
  return [version[0], version[1]].join('.')
}
