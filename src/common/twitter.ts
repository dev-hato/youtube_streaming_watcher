import { TwitterApiReadOnly } from 'twitter-api-v2'
import sleep from 'sleep-promise'

if (process.env.TWITTER_BEARER_TOKEN === undefined) {
  throw new Error('TWITTER_BEARER_TOKEN must be set.')
}

export const twitterApiReadOnly = new TwitterApiReadOnly(process.env.TWITTER_BEARER_TOKEN)

export async function getTwitterUserId (userName: string): Promise<string> {
  await sleep(1000)
  console.log('get twitter user:', userName)
  const user = await twitterApiReadOnly.v2.userByUsername(userName)
  return user.data.id
}
