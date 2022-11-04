const axios = require('axios')
const cheerio = require('cheerio')
const { Text } = require('domhandler')

module.exports = async () => {
  const response = await axios.get('https://docs.aws.amazon.com/ja_jp/lambda/latest/dg/lambda-runtimes.html')
  const $ = cheerio.load(response.data)
  const versions = []

  for (const element of $('table tbody tr:first-child td:first-child p').get()) {
    const textElement = element.children[0]
    if (textElement instanceof Text && textElement.data.startsWith('Node')) {
      const texts = textElement.data.split(' ')
      if (texts.length > 1) {
        versions.push(Number(texts[1]))
      }
    }
  }

  return Math.max(...versions)
}
