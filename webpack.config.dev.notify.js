const path = require('path')
const dev = require('./webpack.config.dev')
const { merge } = require('webpack-merge')

module.exports = merge(dev, {
  entry: {
    notify: path.resolve(__dirname, './src/notify/index.dev.ts')
  }
})
