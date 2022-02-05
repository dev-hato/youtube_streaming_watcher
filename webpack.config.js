const path = require('path')
const common = require('./webpack.config.common')
const { merge } = require('webpack-merge')

module.exports = merge(common, {
  mode: 'production',
  externals: ['@aws-sdk', 'aws-crt', 'express'],
  entry: {
    notify: path.resolve(__dirname, './src/notify/index.ts'),
    reply: path.resolve(__dirname, './src/reply/index.ts')
  },
  output: {
    path: path.join(__dirname, 'dist', 'lambda')
  }
})
