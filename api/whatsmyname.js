const UPSTREAM = 'https://whatsmyname.ink/api/search';

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

export default async function handler(req, res) {

  // Only POST is used by Vortex
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');

    return res.status(405).json({
      error: 'Method not allowed. Use POST /api/whatsmyname.'
    });
  }

  try {

    // Read request body
    const body =
      typeof req.body === 'string'
        ? JSON.parse(req.body || '{}')
        : (req.body || {});

    // Clean username
    const username = String(body.username || '')
      .replace(/^@/, '')
      .trim();

    if (!username) {
      return res.status(400).json({
        error: 'Username is required.'
      });
    }

    // ---------------------------------------
    // STEP 1: Start WhatsMyName search
    // ---------------------------------------

    const startResponse = await fetch(UPSTREAM, {
      method: 'POST',

      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },

      body: JSON.stringify({
        username: username
      })
    });

    const startData = await readJson(startResponse);

    if (!startResponse.ok) {
      return res.status(502).json({
        error: 'WhatsMyName could not start the search.',
        upstreamStatus: startResponse.status,
        upstream: startData
      });
    }

    const queryId = startData.queryId;

    if (!queryId) {
      return res.status(502).json({
        error: 'WhatsMyName did not return a query ID.',
        upstream: startData
      });
    }

    // ---------------------------------------
    // STEP 2: Poll WhatsMyName server-side
    // ---------------------------------------

    let lastData = startData;

    for (let attempt = 0; attempt < 90; attempt++) {

      // First wait 500ms, then 1 second
      await sleep(
        attempt === 0 ? 500 : 1000
      );

      const pollResponse = await fetch(
        `${UPSTREAM}?id=${encodeURIComponent(queryId)}`,
        {
          method: 'GET',

          headers: {
            'Accept': 'application/json'
          },

          cache: 'no-store'
        }
      );

      const pollData = await readJson(pollResponse);

      lastData = pollData;

      // ---------------------------------------
      // Specifically detect HTTP 405
      // ---------------------------------------

      if (pollResponse.status === 405) {

        return res.status(502).json({
          error:
            'WhatsMyName polling returned HTTP 405. The upstream API is rejecting the documented GET polling request.',

          upstreamStatus: 405,

          queryId: queryId,

          upstream: pollData
        });
      }

      // ---------------------------------------
      // Other HTTP errors
      // ---------------------------------------

      if (!pollResponse.ok) {

        return res.status(502).json({
          error: 'WhatsMyName polling failed.',

          upstreamStatus: pollResponse.status,

          queryId: queryId,

          upstream: pollData
        });
      }

      // ---------------------------------------
      // Search completed
      // ---------------------------------------

      const status =
        String(pollData.status || '').toLowerCase();

      if (status === 'completed') {

        return res.status(200).json(pollData);
      }

      // ---------------------------------------
      // Search failed
      // ---------------------------------------

      if (
        status === 'error' ||
        status === 'failed'
      ) {

        return res.status(502).json({
          error:
            pollData.error ||
            'WhatsMyName reported a failed search.',

          upstreamStatus: pollResponse.status,

          queryId: queryId,

          upstream: pollData
        });
      }
    }

    // ---------------------------------------
    // Timeout
    // ---------------------------------------

    return res.status(504).json({

      error:
        'WhatsMyName search timed out after 90 seconds.',

      queryId: queryId,

      upstream: lastData
    });

  } catch (error) {

    console.error(
      'Vortex WhatsMyName proxy error:',
      error
    );

    return res.status(500).json({

      error:
        'Vortex serverless function failed.',

      details:
        error instanceof Error
          ? error.message
          : String(error)
    });
  }
          }
