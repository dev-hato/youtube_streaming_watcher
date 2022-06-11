import axios from 'axios'
import sleep from 'sleep-promise'

export async function getTwitterUserName (youtubeChannelId: string): Promise<string> {
  await sleep(1000)
  const url = `https://www.youtube.com/channel/${youtubeChannelId}/about`
  console.log('get:', url)
  const response = await axios.get(url)

  for (const pattern of [/twitter.com%2F(\w{1,50})"/, /twitter.com\/(\w{1,50})/]) {
    const userNames = response.data.match(pattern)
    if (userNames !== null && 1 < userNames.length) {
      return userNames[1]
    }
  }

  throw new Error(`Twitter ID can not be found on YouTube about page: ${youtubeChannelId}`)
}
