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
    url: username =>
      `https://www.reddit.com/user/${encodeURIComponent(username)}/`
  },
  {
    platform: 'Keybase',
    url: username => `https://keybase.io/${encodeURIComponent(username)}`
  }
];

// Temporary in-memory cache.
// Note: serverless instances can restart, so the second request may
// occasionally land on another instance. The HTML currently sends the
// same username both times, so we also support returning the result
// directly if a cached job is unavailable.
const jobs = new Map();

function cleanUsername(value) {
  return String(value || '')
    .replace(/^@/, '')
    .trim();
}

function makeQueryId() {
  return (
    Date.now().toString(36) +
    '-' +
    Math.random().toString(36).slice(2, 10)
  );
}

async function checkSite(site, username) {
  const url = site.url(username);
  const started = Date.now();

  const controller = new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    8000
  );

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
      responseTime: Date.now() - started
    };

  } catch (error) {

    return {
      platform: site.platform,
      url,
      status: 'unknown',
      responseTime: Date.now() - started
    };

  } finally {

    clearTimeout(timer);

  }
}

async function runSweep(username) {

  const results = await Promise.all(
    SITES.map(site =>
      checkSite(site, username)
    )
  );

  return {
    username,
    status: 'completed',
    totalPlatforms: results.length,
    results
  };
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

    const username =
      cleanUsername(body.username);

    const queryId =
      String(body.queryId || body.id || '');

    /*
     * OLD HTML COMPATIBILITY
     *
     * If the request includes a query ID, return the stored result.
     */
    if (queryId) {

      const job =
        jobs.get(queryId);

      if (job) {

        return res.status(200).json(
          job
        );

      }

      return res.status(404).json({
        error: 'Search job not found.'
      });

    }


    if (!username) {

      return res.status(400).json({
        error: 'Username is required.'
      });

    }


    /*
     * Run the sweep immediately.
     */
    const result =
      await runSweep(username);


    /*
     * Create a query ID so the old Vortex HTML
     * can continue using its first-call workflow.
     */
    const newQueryId =
      makeQueryId();


    jobs.set(
      newQueryId,
      {
        ...result,
        queryId: newQueryId
      }
    );


    /*
     * Remove the temporary result after 2 minutes.
     */
    setTimeout(() => {

      jobs.delete(
        newQueryId
      );

    }, 120000);


    /*
     * The old HTML's first request expects queryId.
     */
    return res.status(200).json({

      queryId: newQueryId,

      totalPlatforms:
        result.totalPlatforms

    });


  } catch (error) {

    console.error(
      'Username sweep error:',
      error
    );

    return res.status(500).json({

      error:
        'Username sweep failed.',

      details:
        error instanceof Error
          ? error.message
          : String(error)

    });

  }

      }
