
const clientId = process.env.TRANSFEERA_CLIENT_ID;
const clientSecret = process.env.TRANSFEERA_CLIENT_SECRET;
const env = process.env.TRANSFEERA_ENV || 'sandbox';

const authUrl = env === 'sandbox' 
    ? 'https://login-api-sandbox.transfeera.com/authorization' 
    : 'https://login-api.transfeera.com/authorization';

const apiUrl = env === 'sandbox'
    ? 'https://api-sandbox.transfeera.com/transferencias'
    : 'https://api.transfeera.com/transferencias';

async function test() {
    console.log(`Starting Transfeera Diagnostic (Env: ${env})`);
    console.log(`Auth URL: ${authUrl}`);
    console.log(`API URL: ${apiUrl}`);

    if (!clientId || !clientSecret) {
        console.error("Missing credentials in ENV.");
        return;
    }

    try {
        console.log("Authenticating...");
        const authRes = await fetch(authUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                grant_type: 'client_credentials',
                client_id: clientId,
                client_secret: clientSecret
            })
        });

        if (!authRes.ok) {
            console.error(`Auth Failed: ${authRes.status}`);
            console.error(await authRes.text());
            return;
        }

        const authData = await authRes.json();
        const token = authData.access_token;
        console.log("Auth Success. Token obtained.");

        const testId = process.argv[2] || "ANY_ID";
        console.log(`Querying transfer with id_integracao: ${testId}`);

        const qs = new URLSearchParams({ id_integracao: testId }).toString();
        const res = await fetch(`${apiUrl}?${qs}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        console.log(`Query Status: ${res.status}`);
        const body = await res.text();
        console.log(`Query Response: ${body}`);

    } catch (e) {
        console.error("Execution error:", e);
    }
}

test();
