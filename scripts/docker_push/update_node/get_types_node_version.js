const packages = require(`${process.env.GITHUB_WORKSPACE}/package.json`) // eslint @typescript-eslint/no-var-requires: 0

module.exports = () => {
  const version = packages.devDependencies['@types/node'].split('.')
  return [version[0], version[1]].join('.')
}
