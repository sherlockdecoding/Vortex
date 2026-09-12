export default async function handler(req, res) {
  const API = 'https://whatsmyname.ink/api/search';

  try {
    if (req.method === 'POST') {
      const response = await fetch(API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(req.body)
      });

      const text = await response.text();

      res.status(response.status);

      try {
        return res.json(JSON.parse(text));
      } catch {
        return res.send(text);
      }
    }

    if (req.method === 'GET') {
      const id = req.query.id;

      if (!id) {
        return res.status(400).json({
          error: 'Missing query ID'
        });
      }

      const response = await fetch(
        `${API}?id=${encodeURIComponent(id)}`
      );

      const text = await response.text();

      res.status(response.status);

      try {
        return res.json(JSON.parse(text));
      } catch {
        return res.send(text);
      }
    }

    res.setHeader('Allow', ['GET', 'POST']);

    return res.status(405).json({
      error: 'Method not allowed'
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error: 'WhatsMyName API request failed',
      details: error.message
    });
  }
          }
