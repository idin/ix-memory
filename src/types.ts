export type Env = {
  OAUTH_KV: KVNamespace;
  MCP_OBJECT: DurableObjectNamespace;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  COOKIE_ENCRYPTION_KEY: string;
  /** Fine-grained PAT, scoped to the memory repo with contents read/write. */
  MEMORY_REPO_TOKEN: string;
  /** Repo coordinates — not hardcoded, so this server is reusable. */
  MEMORY_REPO_OWNER: string;
  MEMORY_REPO_NAME: string;
  MEMORY_REPO_BRANCH: string;
  /** The single GitHub login permitted to authenticate. */
  ALLOWED_GITHUB_LOGIN: string;
};

/** Identity of the authenticated caller, carried through to the MCP agent. */
export type UserProps = {
  login: string;
  name: string;
};
