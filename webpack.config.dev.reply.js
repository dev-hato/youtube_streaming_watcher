const path = require('path')
const dev = require('./webpack.config.dev')
const { merge } = require('webpack-merge')

module.exports = merge(dev, {
  entry: {
    reply: path.resolve(__dirname, './src/reply/index.dev.ts')
  }
})
