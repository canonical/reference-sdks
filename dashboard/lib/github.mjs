export class GitHubError extends Error {
  constructor(status, path, body) {
    super(`GitHub API ${status} for ${path}: ${body.slice(0, 200)}`);
    this.status = status;
    this.path = path;
  }
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export function createClient({
  token,
  fetchImpl = globalThis.fetch,
  baseUrl = 'https://api.github.com',
  maxAttempts = 3,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const rateLimit = { remaining: null, reset: null };
  let requests = 0;

  async function request(url) {
    for (let attempt = 1; ; attempt += 1) {
      requests += 1;
      const res = await fetchImpl(url, {
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${token}`,
          'x-github-api-version': '2022-11-28',
          'user-agent': 'reference-sdks-dashboard',
        },
      });
      const remaining = res.headers.get('x-ratelimit-remaining');
      if (remaining !== null) {
        rateLimit.remaining = Number(remaining);
        rateLimit.reset = Number(res.headers.get('x-ratelimit-reset'));
      }
      if (res.ok) return res;
      const body = await res.text();
      const retryAfter = Number(res.headers.get('retry-after'));
      const secondaryLimit = res.status === 403 && retryAfter > 0;
      if (attempt < maxAttempts && (RETRYABLE.has(res.status) || secondaryLimit)) {
        await sleep((retryAfter || 2 ** attempt) * 1000);
        continue;
      }
      throw new GitHubError(res.status, new URL(url).pathname, body);
    }
  }

  function toUrl(path, params = {}) {
    const url = new URL(path, baseUrl);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  // `optional` turns "not found / not permitted" into null instead of an error.
  async function get(path, { params, optional = false } = {}) {
    try {
      const res = await request(toUrl(path, params));
      return await res.json();
    } catch (error) {
      if (optional && error instanceof GitHubError && [403, 404].includes(error.status)) return null;
      throw error;
    }
  }

  async function paginate(path, { params, key, maxPages = 5 } = {}) {
    const items = [];
    let url = toUrl(path, { per_page: 100, ...params });
    for (let page = 0; url && page < maxPages; page += 1) {
      const res = await request(url);
      const data = await res.json();
      items.push(...(key ? data[key] : data));
      url = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get('link') ?? '')?.[1] ?? null;
    }
    return items;
  }

  return {
    get,
    paginate,
    stats: () => ({ requests, rateLimit: { ...rateLimit } }),
  };
}
