
const clientId = process.env.TRANSFEERA_CLIENT_ID;
const clientSecret = process.env.TRANSFEERA_CLIENT_SECRET;
const env = process.env.TRANSFEERA_ENV || 'sandbox';

const authUrl = env === 'sandbox' 
    ? 'https://login-api-sandbox.transfeera.com/authorization' 
    : 'https://login-api.transfeera.com/authorization';

// Testing the user-suggested format: /transfer/{id}
const apiBaseUrl = env === 'sandbox'
    ? 'https://api-sandbox.transfeera.com'
    : 'https://api.transfeera.com';

async function test() {
    console.log(`Starting Alternative Endpoint Test (Env: ${env})`);
    
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
        console.log("Auth Success.");

        const testId = process.argv[2];
        if (!testId) {
            console.error("Please provide an id as argument.");
            return;
        }

        // Test Type A: /transferencias?id_integracao=... (Current)
        console.log("\n--- Testing Current Format (/transferencias?id_integracao=...) ---");
        const urlA = `${apiBaseUrl}/transferencias?id_integracao=${testId}`;
        const resA = await fetch(urlA, { headers: { 'Authorization': `Bearer ${token}` } });
        console.log(`Status: ${resA.status}`);
        console.log(`Body: ${await resA.text()}`);

        // Test Type B: /transfer/{id} (User Suggested)
        console.log("\n--- Testing User Format (/transfer/{id}) ---");
        const urlB = `${apiBaseUrl}/transfer/${testId}`;
        const resB = await fetch(urlB, { headers: { 'Authorization': `Bearer ${token}` } });
        console.log(`Status: ${resB.status}`);
        console.log(`Body: ${await resB.text()}`);

        // Test Type C: /transferencias/{id} (Official V2 for specific ID)
        console.log("\n--- Testing Official V2 Single ID (/transferencias/{id}) ---");
        const urlC = `${apiBaseUrl}/transferencias/${testId}`;
        const resC = await fetch(urlC, { headers: { 'Authorization': `Bearer ${token}` } });
        console.log(`Status: ${resC.status}`);
        console.log(`Body: ${await resC.text()}`);

    } catch (e) {
        console.error("Execution error:", e);
    }
}

test();
