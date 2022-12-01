async function getActionsGetActionsCacheList ({ github, context }) {
  const actionsGetActionsCacheListParams = {
    owner: context.repo.owner,
    repo: context.repo.repo,
    sort: 'last_accessed_at',
    direction: 'asc'
  }
  console.log('call actions.getActionsCacheList', actionsGetActionsCacheListParams)
  return github.paginate(
    github.rest.actions.getActionsCacheList,
    actionsGetActionsCacheListParams
  )
}

function getSumSize (actionsGetActionsCacheList) {
  return actionsGetActionsCacheList.reduce((sum, size) => sum + (size.size_in_bytes ?? 0), 0)
}

module.exports = async ({ github, context }) => {
  let actionsGetActionsCacheList = await getActionsGetActionsCacheList({ github, context })
  let sumSize = getSumSize(actionsGetActionsCacheList)

  while (8 * 1024 * 1024 * 1024 < sumSize) {
    const actionCache = actionsGetActionsCacheList.shift()
    const actionsDeleteActionsCacheByKey = {
      owner: context.repo.owner,
      repo: context.repo.repo,
      key: actionCache.key
    }
    console.log('call actions.deleteActionsCacheByKey', actionsDeleteActionsCacheByKey)

    try {
      await github.rest.actions.deleteActionsCacheByKey(
        actionsDeleteActionsCacheByKey
      )
    } catch (e) {
      if (e.status === 404) {
        actionsGetActionsCacheList = await getActionsGetActionsCacheList({ github, context })
        sumSize = getSumSize(actionsGetActionsCacheList)
        continue
      }

      throw e
    }

    sumSize -= actionCache.size_in_bytes
  }
}
