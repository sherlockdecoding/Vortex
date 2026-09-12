export const config = {
  maxDuration: 60
};

const SITES = [
  {
    platform: 'GitHub',
    url: username => `https://github.com/${encodeURIComponent(username)}`
  },
  {
    platform: 'GitLab',
    url: username => `https://gitlab.com/${encodeURIComponent(username)}`
  },
  {
    platform: 'Reddit',
    url: username => `https://www.reddit.com/user/${encodeURIComponent(username)}/`
  },
  {
    platform: 'Keybase',
    url: username => `https://keybase.io/${encodeURIComponent(username)}`
  }
];

async function checkSite(site, username) {
  const url = site.url(username);
  const start = Date.now();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0'
      }
    });

    let status = 'unknown';

    if (response.status === 404) {
      status = 'not_found';
    } else if (response.ok) {
      status = 'hit';
    }

    return {
      platform: site.platform,
      url,
      status,
      responseTime: Date.now() - start
    };

  } catch (error) {

    return {
      platform: site.platform,
      url,
      status: 'unknown',
      responseTime: Date.now() - start
    };

  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req, res) {

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');

    return res.status(405).json({
      error: 'Method not allowed. Use POST.'
    });
  }

  try {

    const body =
      typeof req.body === 'string'
        ? JSON.parse(req.body || '{}')
        : (req.body || {});

    const username = String(body.username || '')
      .replace(/^@/, '')
      .trim();

    if (!username) {
      return res.status(400).json({
        error: 'Username is required.'
      });
    }

    const results = await Promise.all(
      SITES.map(site => checkSite(site, username))
    );

    return res.status(200).json({
      username,
      status: 'completed',
      totalPlatforms: results.length,
      results
    });

  } catch (error) {

    console.error('Username sweep failed:', error);

    return res.status(500).json({
      error: 'Username sweep failed.'
    });
  }
}
