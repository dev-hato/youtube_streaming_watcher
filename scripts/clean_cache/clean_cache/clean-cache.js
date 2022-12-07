module.exports = async ({ github, context }) => {
  const actionsGetActionsCacheListParams = {
    owner: context.repo.owner,
    repo: context.repo.repo,
    sort: 'last_accessed_at',
    direction: 'asc'
  }
  console.log('call actions.getActionsCacheList', actionsGetActionsCacheListParams)
  const actionsGetActionsCacheList = await github.paginate(
    github.rest.actions.getActionsCacheList,
    actionsGetActionsCacheListParams
  )
  let sumSize = actionsGetActionsCacheList.reduce((sum, size) => sum + (size.size_in_bytes ?? 0), 0)

  while (7 * 1024 * 1024 * 1024 < sumSize) {
    const actionCache = actionsGetActionsCacheList.shift()
    const actionsDeleteActionsCacheByKey = {
      owner: context.repo.owner,
      repo: context.repo.repo,
      key: actionCache.key
    }
    console.log('call actions.deleteActionsCacheByKey', actionsDeleteActionsCacheByKey)
    await github.rest.actions.deleteActionsCacheByKey(actionsDeleteActionsCacheByKey)
    sumSize -= actionCache.size_in_bytes
  }
}
