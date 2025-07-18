export async function handler() {
  try {
    const res = await fetch("https://broadcasting-api.onrender.com/");
    if (!res.ok) {
      return {
        statusCode: res.status,
        body: `Backend ping failed with status ${res.status}`
      };
    }
    return {
      statusCode: 200,
      body: "Pinged Render API successfully"
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: `Ping error: ${err.message}`
    };
  }
}
