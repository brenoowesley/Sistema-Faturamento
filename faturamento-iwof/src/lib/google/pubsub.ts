import { PubSub } from "@google-cloud/pubsub";

const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");

if (!clientEmail || !privateKey) {
    console.warn("Google Cloud Pub/Sub credentials not found in environment variables.");
}

export const pubsub = new PubSub({
    credentials: {
        client_email: clientEmail,
        private_key: privateKey,
    },
});

export const TOPICS = {
    NC_TAREFAS: "nc-tarefas",
    // FATURAS_DESCRITIVOS: "faturas-descritivos", // Reserved for future use
};
