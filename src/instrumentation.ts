// Must be imported before anything that creates observations.
import dotenv from 'dotenv';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { LangfuseSpanProcessor } from '@langfuse/otel';

dotenv.config({ quiet: true });
process.env.LANGFUSE_BASE_URL ??= process.env.LANGFUSE_HOST;
process.env.LANGFUSE_TRACING_ENVIRONMENT ??= 'development';

// OpenRouter wants raw base64 audio, but Langfuse only uploads base64 as playable media when it is a data URI.
// Rewrite the trace copy only; the request sent to OpenRouter is untouched.
const RAW_AUDIO = /"input_audio":\{"data":"([A-Za-z0-9+/=]{100,})","format":"(\w+)"\}/g;
const audioAsDataUri = (data: unknown) =>
  typeof data === 'string'
    ? data.replace(RAW_AUDIO, '"input_audio":{"data":"data:audio/$2;base64,$1","format":"$2"}')
    : data;

export const langfuseSpanProcessor = new LangfuseSpanProcessor({ mask: ({ data }) => audioAsDataUri(data) });

export const sdk = new NodeSDK({ spanProcessors: [langfuseSpanProcessor] });
sdk.start();
