module.exports = async ({ github, context }) => {
  const RESULT = process.env.RESULT
  let body = 'インフラの差分\n<details>\n\n```\n'
  body += RESULT.replace(/%0D/g, '\r').replace(/%0A/g, '\n').replace(/%25/g, '%').trim()
  body += '\n```\n\n</details>'
  await github.rest.issues.createComment({
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number: context.issue.number,
    body
  })
}
