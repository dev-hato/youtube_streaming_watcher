const packages = require(`${process.env.GITHUB_WORKSPACE}/package.json`)

module.exports = () => {
  const version = packages.devDependencies['@types/node'].split('.')
  return [version[0], version[1]].join('.')
}
