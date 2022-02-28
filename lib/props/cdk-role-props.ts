type CDKRoleProp = {
    name: string;
    oidcSub: string;
}

export const cdkRoleProps: CDKRoleProp[] = [
  { name: 'diff', oidcSub: 'pull_request' },
  { name: 'deploy', oidcSub: 'ref:refs/heads/main' }
]
