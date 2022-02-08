module.exports = {
  target: 'node',
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: {
          loader: 'ts-loader'
        }
      }
    ]
  },
  resolve: {
    extensions: ['.js', '.ts']
  },
  output: {
    filename: '[name].js',
    libraryTarget: 'commonjs2'
  }
}
