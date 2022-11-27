module.exports = async ({github, context}) => {
  while (true) {
    const actionsGetActionsCacheUsageParams = {
      owner: context.repo.owner,
      repo: context.repo.repo
    }
    console.log('call actions.getActionsCacheUsage', actionsGetActionsCacheUsageParams)
    const actionsCacheUsage = await github.rest.actions.getActionsCacheUsage(actionsGetActionsCacheUsageParams)

    if (actionsCacheUsage.data.active_caches_size_in_bytes <= 9 * 1024 * 1024 * 1024) {
      return
    }

    const actionsGetActionsCacheListParams = {
      owner: context.repo.owner,
      repo: context.repo.repo,
      sort: 'last_accessed_at',
      direction: 'asc'
    }
    console.log('call actions.getActionsCacheList', actionsGetActionsCacheListParams)
    const actionsGetActionsCacheList = await github.rest.actions.getActionsCacheList(actionsGetActionsCacheListParams)
    const actionCaches = actionsGetActionsCacheList.data.actions_caches

    if (actionCaches.length < 1) {
      return
    }

    const actionsDeleteActionsCacheByKey = {
      owner: context.repo.owner,
      repo: context.repo.repo,
      key: actionCaches[0].key
    }
    console.log('call actions.deleteActionsCacheByKey', actionsDeleteActionsCacheByKey)
    await github.rest.actions.deleteActionsCacheByKey(actionsDeleteActionsCacheByKey)
  }
}
