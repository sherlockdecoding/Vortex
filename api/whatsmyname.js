const UPSTREAM = 'https://whatsmyname.ink/api/search';

export const config = {
  maxDuration: 60
};

const DEADLINE = 52_000;

const sleep = (ms) =>
  new Promise(resolve => setTimeout(resolve, ms));

async function readJson(response) {
  const text = await response.text();

  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

async function fetchWithTimeout(url, options = {}, timeout = 6000) {
  const controller = new AbortController();

  const timer = setTimeout(() => {
    controller.abort();
  }, timeout);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      cache: 'no-store'
    });
  } finally {
    clearTimeout(timer);
  }
}

function isTransient(status) {
  return [
    408,
    425,
    429,
    500,
    502,
    503,
    504
  ].includes(status);
}

export default async function handler(req, res) {

  // Only POST is used by the Vortex frontend.
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');

    return res.status(405).json({
      error: 'Method not allowed.'
    });
  }

  const startedAt = Date.now();

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

    // --------------------------------------------------
    // STEP 1 — START SEARCH
    // --------------------------------------------------

    let startResponse;
    let startData = {};
    let startAttempt = 0;

    while (startAttempt < 3) {

      if (Date.now() - startedAt >= DEADLINE) {
        return res.status(504).json({
          error: 'Username search timed out.'
        });
      }

      startAttempt++;

      try {

        startResponse = await fetchWithTimeout(
          UPSTREAM,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json'
            },
            body: JSON.stringify({
              username
            })
          },
          8000
        );

        startData = await readJson(startResponse);

      } catch (error) {

        console.error(
          'START REQUEST ERROR',
          error instanceof Error
            ? error.message
            : String(error)
        );

        if (startAttempt >= 3) {
          return res.status(502).json({
            error: 'Username search service is temporarily unavailable.'
          });
        }

        await sleep(500 * startAttempt);
        continue;
      }

      if (startResponse.ok) {
        break;
      }

      console.error(
        'START FAILED',
        startResponse.status,
        JSON.stringify(startData)
      );

      // Rate limit
      if (startResponse.status === 429) {
        return res.status(429).json({
          error: 'Too many searches. Please try again shortly.'
        });
      }

      // Retry temporary upstream failures
      if (
        isTransient(startResponse.status) &&
        startAttempt < 3
      ) {
        await sleep(500 * startAttempt);
        continue;
      }

      return res.status(502).json({
        error: 'Username search could not be started.'
      });
    }

    // --------------------------------------------------
    // SEARCH COMPLETED IMMEDIATELY
    // --------------------------------------------------

    if (
      String(startData.status || '').toLowerCase() === 'completed' ||
      Array.isArray(startData.results)
    ) {
      return res.status(200).json(startData);
    }

    // --------------------------------------------------
    // GET QUERY ID
    // --------------------------------------------------

    const queryId = startData.queryId;

    if (!queryId) {

      console.error(
        'NO QUERY ID',
        JSON.stringify(startData)
      );

      return res.status(502).json({
        error: 'Username search did not return a query ID.'
      });
    }

    // --------------------------------------------------
    // STEP 2 — POLL SEARCH
    //
    // IMPORTANT:
    // WhatsMyName polling uses GET /api/search?id=...
    // NOT POST.
    // --------------------------------------------------

    let lastData = startData;

    let delay = 750;

    while (Date.now() - startedAt < DEADLINE) {

      await sleep(delay);

      if (Date.now() - startedAt >= DEADLINE) {
        break;
      }

      const remaining = DEADLINE - (Date.now() - startedAt);

      const pollTimeout = Math.min(
        6000,
        Math.max(1000, remaining - 500)
      );

      const pollUrl =
        `${UPSTREAM}?id=${encodeURIComponent(queryId)}`;

      let pollResponse;
      let pollData = {};

      try {

        pollResponse = await fetchWithTimeout(
          pollUrl,
          {
            method: 'GET',
            headers: {
              'Accept': 'application/json'
            }
          },
          pollTimeout
        );

        pollData = await readJson(pollResponse);

        lastData = pollData;

      } catch (error) {

        console.error(
          'POLL REQUEST ERROR',
          error instanceof Error
            ? error.message
            : String(error)
        );

        // Temporary network failure.
        // Keep polling the SAME query.
        delay = Math.min(
          Math.round(delay * 1.5),
          4000
        );

        continue;
      }

      // ------------------------------------------------
      // COMPLETED
      // ------------------------------------------------

      const status =
        String(pollData.status || '').toLowerCase();

      if (status === 'completed') {

        return res.status(200).json(pollData);
      }

      // ------------------------------------------------
      // SEARCH REPORTED FAILURE
      // ------------------------------------------------

      if (
        status === 'error' ||
        status === 'failed'
      ) {

        console.error(
          'SEARCH REPORTED FAILURE',
          JSON.stringify(pollData)
        );

        return res.status(502).json({
          error:
            'Username search failed.'
        });
      }

      // ------------------------------------------------
      // RATE LIMIT
      // ------------------------------------------------

      if (pollResponse.status === 429) {

        console.error(
          'POLL RATE LIMITED',
          JSON.stringify(pollData)
        );

        // Don't expose provider details.
        return res.status(429).json({
          error:
            'Too many searches. Please try again shortly.'
        });
      }

      // ------------------------------------------------
      // TEMPORARY UPSTREAM ERROR
      //
      // Do NOT immediately return 502.
      // Continue polling the same query ID.
      // ------------------------------------------------

      if (
        !pollResponse.ok &&
        isTransient(pollResponse.status)
      ) {

        console.error(
          'TEMPORARY POLL FAILURE',
          pollResponse.status
        );

        delay = Math.min(
          Math.round(delay * 1.5),
          4000
        );

        continue;
      }

      // ------------------------------------------------
      // OTHER HTTP ERROR
      // ------------------------------------------------

      if (!pollResponse.ok) {

        console.error(
          'POLL FAILED',
          pollResponse.status,
          JSON.stringify(pollData)
        );

        return res.status(502).json({
          error:
            'Username search could not be completed.'
        });
      }

      // ------------------------------------------------
      // STILL RUNNING
      // ------------------------------------------------

      delay = Math.min(
        Math.round(delay * 1.35),
        4000
      );
    }

    // --------------------------------------------------
    // INTERNAL DEADLINE REACHED
    // --------------------------------------------------

    console.error(
      'POLL TIMED OUT',
      JSON.stringify({
        queryId,
        lastData
      })
    );

    return res.status(504).json({
      error:
        'Username search timed out. Please try again.'
    });

  } catch (error) {

    console.error(
      'Vortex username proxy error:',
      error
    );

    return res.status(500).json({
      error:
        'Username search service failed.'
    });
  }
      }
