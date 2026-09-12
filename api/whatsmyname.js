export const config = {
  maxDuration: 60
};

const SITES = [
  {
    platform: 'GitHub',
    url: username =>
      `https://github.com/${encodeURIComponent(username)}`
  },
  {
    platform: 'GitLab',
    url: username =>
      `https://gitlab.com/${encodeURIComponent(username)}`
  },
  {
    platform: 'Reddit',
    url: username =>
      `https://www.reddit.com/user/${encodeURIComponent(username)}/`
  },
  {
    platform: 'Keybase',
    url: username =>
      `https://keybase.io/${encodeURIComponent(username)}`
  }
];


/* Temporary completed searches */

const completedSearches = new Map();


function cleanUsername(value) {

  return String(value || '')
    .replace(/^@/, '')
    .trim()
    .toLowerCase();

}


function makeQueryId() {

  return (
    Date.now().toString(36) +
    '-' +
    Math.random()
      .toString(36)
      .slice(2, 10)
  );

}


async function checkSite(site, username) {

  const url = site.url(username);

  const started =
    Date.now();

  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () => controller.abort(),
      8000
    );


  try {

    const response =
      await fetch(url, {

        method: 'GET',

        redirect: 'follow',

        signal:
          controller.signal,

        headers: {
          'User-Agent':
            'Mozilla/5.0'
        }

      });


    let status =
      'unknown';


    if (
      response.status === 404
    ) {

      status =
        'not_found';

    }

    else if (
      response.ok
    ) {

      status =
        'hit';

    }


    return {

      platform:
        site.platform,

      url,

      status,

      responseTime:
        Date.now() - started

    };


  } catch (error) {

    return {

      platform:
        site.platform,

      url,

      status:
        'unknown',

      responseTime:
        Date.now() - started

    };


  } finally {

    clearTimeout(
      timer
    );

  }

}


async function runSweep(username) {

  const results =
    await Promise.all(

      SITES.map(
        site =>
          checkSite(
            site,
            username
          )
      )

    );


  return {

    username,

    status:
      'completed',

    totalPlatforms:
      results.length,

    results

  };

}


export default async function handler(
  req,
  res
) {


  if (
    req.method !== 'POST'
  ) {

    res.setHeader(
      'Allow',
      'POST'
    );


    return res
      .status(405)
      .json({

        error:
          'Method not allowed. Use POST.'

      });

  }


  try {


    const body =

      typeof req.body === 'string'

        ? JSON.parse(
            req.body || '{}'
          )

        : (
            req.body || {}
          );


    const username =
      cleanUsername(
        body.username
      );


    const requestedQueryId =
      String(
        body.queryId ||
        body.id ||
        ''
      );


    /*
     * ------------------------------------------------
     * If old Vortex sends a query ID,
     * try to return that completed search.
     * ------------------------------------------------
     */

    if (
      requestedQueryId
    ) {

      for (
        const search of
        completedSearches.values()
      ) {

        if (
          search.queryId ===
          requestedQueryId
        ) {

          return res
            .status(200)
            .json(
              search
            );

        }

      }


      return res
        .status(404)
        .json({

          error:
            'Search job not found.'

        });

    }


    /*
     * Username is required.
     */

    if (
      !username
    ) {

      return res
        .status(400)
        .json({

          error:
            'Username is required.'

        });

    }


    /*
     * ------------------------------------------------
     * SECOND REQUEST FOR SAME USERNAME
     *
     * Return completed results.
     *
     * This lets the old Vortex HTML work even if
     * it sends the username again instead of queryId.
     * ------------------------------------------------
     */

    const existing =
      completedSearches.get(
        username
      );


    if (
      existing
    ) {

      return res
        .status(200)
        .json(
          existing
        );

    }


    /*
     * ------------------------------------------------
     * FIRST REQUEST
     *
     * Run the sweep and store it.
     * Return only queryId so the old HTML continues
     * to its second request.
     * ------------------------------------------------
     */

    const result =
      await runSweep(
        username
      );


    const queryId =
      makeQueryId();


    const completedResult = {

      ...result,

      queryId

    };


    completedSearches.set(

      username,

      completedResult

    );


    /*
     * Remove after 2 minutes.
     */

    setTimeout(
      () => {

        completedSearches.delete(
          username
        );

      },

      120000
    );


    /*
     * First response:
     * compatible with old Vortex.
     */

    return res
      .status(200)
      .json({

        queryId,

        totalPlatforms:
          result.totalPlatforms

      });


  } catch (
    error
  ) {


    console.error(
      'Username sweep error:',
      error
    );


    return res
      .status(500)
      .json({

        error:
          'Username sweep failed.',

        details:

          error instanceof Error

            ? error.message

            : String(
                error
              )

      });

  }

             }
