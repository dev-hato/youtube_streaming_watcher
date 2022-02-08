const path = require('path')
const common = require('./webpack.config.common')
const { merge } = require('webpack-merge')

module.exports = merge(common, {
  mode: 'development',
  externals: ['aws-crt', 'express'],
  devtool: 'nosources-source-map',
  output: {
    path: path.join(__dirname, 'dist', 'dev'),
    sourceMapFilename: '[file].map'
  }
})
